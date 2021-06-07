import * as RTDB from "@rtdb2/core";
import { AwaitStore } from "@hibas123/utils";
import { Database, IConnector, IQueryRequest, Snapshot } from "@rtdb2/sdk";

export class EmbeddedConnector implements IConnector {
   #db: RTDB.Database;
   #session: RTDB.Session;

   snapshots = new Map<string, Snapshot<any>>();
   offline = new AwaitStore(false);

   constructor(path: string) {
      this.#db = new RTDB.Database(path);
      this.#session = new RTDB.Session("session");
      this.#session.root = true; // root is always true on the local session
   }

   async queryRequest<T = any>(
      query: IQueryRequest,
      id?: string,
      ns?: string
   ): Promise<T> {
      if (Array.isArray(query)) {
         return this.#db.run(query as RTDB.IQuery[], this.#session);
      } else {
         if (query.type === "snapshot") {
            return (await this.#db.snapshot(
               query as RTDB.ITypedQuery<"snapshot">,
               this.#session,
               (change) => {
                  this.snapshots.get(id).receivedData(change);
               }
            )) as any;
         } else if (query.type === "unsubscribe") {
            return this.#db.unsubscribe(id, this.#session) as any;
         } else {
            return this.#db.run([query as RTDB.IQuery], this.#session);
         }
      }
   }

   async close() {
      await this.#db.stop();
   }
}
