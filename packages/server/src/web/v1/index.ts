import * as Router from "koa-router";
import AdminRoute from "./admin";
import { DatabaseManager } from "../../database";
import {
   NotFoundError,
   NoPermissionError,
   BadRequestError,
} from "../helper/errors";
import Logging from "@hibas123/logging";
import { Session } from "@hibas123/realtimedb-core";
import { nanoid } from "nanoid";
import { verifyJWT } from "../../helper/jwt";
import { QueryError } from "@hibas123/realtimedb-core";
const V1 = new Router({ prefix: "/v1" });

V1.use("/admin", AdminRoute.routes(), AdminRoute.allowedMethods());

V1.post("/db/:database/query", async (ctx) => {
   const { database } = ctx.params;
   const { accesskey, authkey, rootkey } = ctx.query;

   const query = ctx.request.body;
   if (!query) {
      throw new BadRequestError("Query not defined!");
   }

   const session = new Session(nanoid());
   const db = DatabaseManager.getDatabase(database);
   if (!db) {
      throw new NotFoundError("Database not found!");
   }

   if (db.accesskey) {
      if (!accesskey || accesskey !== db.accesskey) {
         throw new NoPermissionError("Invalid Access Key");
      }
   }

   if (authkey && db.publickey) {
      let res = await verifyJWT(authkey as string, db.publickey);
      if (res && !res.uid && res.user) res.uid = res.user;
      if (!res || !res.uid) {
         throw new BadRequestError("Invalid JWT");
      } else {
         session.uid = res.uid;
      }
   }

   if (rootkey && db.rootkey) {
      if (rootkey === db.rootkey) {
         session.root = true;
         Logging.warning(`Somebody logged into ${database} via rootkey`);
      }
   }

   ctx.body = await db.database.run([query], session).catch((err) => {
      if (err instanceof QueryError) {
         throw new BadRequestError(err.message);
      }
      throw err;
   });
});
export default V1;
