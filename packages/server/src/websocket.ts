import Logging from "@hibas123/logging";
import { IncomingMessage, Server } from "http";
import * as WebSocket from "ws";
import { DatabaseManager } from "./database";
import { ITypedQuery, Session } from "@hibas123/realtimedb-core";

import { verifyJWT } from "./helper/jwt";
import { nanoid } from "nanoid";

export class WebsocketConnectionManager {
   static server: WebSocket.Server;

   static bind(server: Server) {
      this.server = new WebSocket.Server({ server });
      this.server.on("connection", this.onConnection.bind(this));
   }

   private static async onConnection(socket: WebSocket, req: IncomingMessage) {
      Logging.log("New Connection:");

      socket.on("error", (err) => {
         Logging.error(err);
         socket.close();
      });

      const sendError = (error: string) =>
         socket.send(JSON.stringify({ ns: "error_msg", data: error }));

      const session = new Session(nanoid());

      const query = new URL(req.url, "http://localhost").searchParams;

      const database = query.get("database");
      const db = DatabaseManager.getDatabase(database);
      if (!db) {
         sendError("Invalid Database!");
         socket.close();
         return;
      }

      const accesskey = query.get("accesskey");
      if (db.accesskey) {
         if (!accesskey || accesskey !== db.accesskey) {
            sendError("Unauthorized!");
            socket.close();
            return;
         }
      }

      const authkey = query.get("authkey");
      if (authkey && db.publickey) {
         let res = await verifyJWT(authkey, db.publickey);
         if (res && !res.uid && res.user) res.uid = res.user;
         if (!res || !res.uid) {
            sendError("Invalid JWT");
            socket.close();
            return;
         } else {
            session.uid = res.uid;
         }
      }

      const rootkey = query.get("rootkey");
      if (rootkey && db.rootkey) {
         if (rootkey === db.rootkey) {
            session.root = true;
            Logging.warning(`Somebody logged into ${database} via rootkey`);
         }
      }

      const answer = (id: string, data: any, err?: Error | string) => {
         let error = false;
         if (err) {
            Logging.error(err);
            if (err instanceof Error) {
               data = err.message;
            } else {
               data = err;
            }

            error = true;
         }
         socket.send(
            JSON.stringify({ ns: "message", data: { id, error, data } })
         );
      };

      const handler = new Map<string, (data: any) => void>();

      handler.set("v2", async ({ id, query }) =>
         db.database
            .run(Array.isArray(query) ? query : [query], session)
            .then((res) => answer(id, res))
            .catch((err) => answer(id, undefined, err))
      );

      // handler.set("bulk", async ({ id, query }) => db.run(query, session)
      //    .then(res => answer(id, res))
      //    .catch(err => answer(id, undefined, err))
      // );

      const SnapshotMap = new Map<string, string>();
      handler.set(
         "snapshot",
         async ({
            id,
            query,
         }: {
            id: string;
            query: ITypedQuery<"snapshot">;
         }) => {
            db.database
               .snapshot(query, session, (data) => {
                  Logging.debug("Sending snapshot");
                  socket.send(
                     JSON.stringify({
                        ns: "snapshot",
                        data: { id, data },
                     })
                  );
               })
               .then((s) => {
                  answer(id, s.snaphot);
                  SnapshotMap.set(id, s.id);
               })
               .catch((err) => answer(id, undefined, err));
         }
      );

      handler.set("unsubscribe", async ({ id }) => {
         let i = SnapshotMap.get(id);
         if (i) {
            db.database.unsubscribe(i, session);
            SnapshotMap.delete(i);
         }
      });

      socket.on("message", async (rawData: string) => {
         try {
            let message: { ns: string; data: any } = JSON.parse(rawData);
            let h = handler.get(message.ns);
            if (h) {
               h(message.data);
            }
         } catch (err) {
            Logging.error("Unknown Error:");
            Logging.error(err);
         }
      });
      db.database.connectionCount++;
      socket.on("close", () => {
         db.database.connectionCount--;
         Logging.log(`${session.id} has disconnected!`);
         session.subscriptions.forEach((unsubscribe) => unsubscribe());
         session.subscriptions.clear();
         socket.removeAllListeners();
      });
   }
}
