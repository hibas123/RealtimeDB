import * as Router from "koa-router";
import Settings from "../../settings";
import getForm from "../helper/form";
import getTable from "../helper/table";
import {
   BadRequestError,
   NoPermissionError,
   NotFoundError,
} from "../helper/errors";
import { DatabaseManager } from "../../database";
import { MP } from "@rtdb2/-core";
import Logging from "@hibas123/logging";
import config from "../../config";
import { getView } from "../helper/hb";

const AdminRoute = new Router();

AdminRoute.use(async (ctx, next) => {
   const { key } = ctx.query;
   if (key !== config.admin) throw new NoPermissionError("No permission!");
   return next();
});

AdminRoute.get("/", async (ctx) => {
   //TODO: Main Interface
   ctx.body = getView("admin");
});

AdminRoute.get("/settings", async (ctx) => {
   let res = await new Promise<string[][]>((yes, no) => {
      const stream = Settings.db.createReadStream({
         keys: true,
         values: true,
         valueAsBuffer: true,
      });
      let res = [["key", "value"]];
      stream.on("data", ({ key, value }) => {
         res.push([key, value]);
      });

      stream.on("error", no);
      stream.on("end", () => yes(res));
   });

   if (ctx.query.view) {
      return getTable("Settings", res, ctx);
   } else {
      ctx.body = res;
   }
});

AdminRoute.get("/data", async (ctx) => {
   const { database } = ctx.query;
   let db = DatabaseManager.getDatabase(database as string);
   if (!db) throw new BadRequestError("Database not found");
   let res = await new Promise<string[][]>((yes, no) => {
      const stream = db.database.data.createReadStream({
         keys: true,
         values: true,
         valueAsBuffer: true,
         keyAsBuffer: false,
         limit: 1000,
      });
      let res = [["key", "value"]];
      stream.on("data", ({ key, value }: { key: string; value: Buffer }) => {
         res.push([
            key,
            key.split("/").length > 2
               ? value.toString()
               : JSON.stringify(MP.decode(value)),
         ]);
      });

      stream.on("error", no);
      stream.on("end", () => yes(res));
   });

   if (ctx.query.view) {
      return getTable("Data from " + database, res, ctx);
   } else {
      ctx.body = res;
   }
});

AdminRoute.get("/database", (ctx) => {
   const isFull = ctx.query.full === "true" || ctx.query.full === "1";
   let res;
   if (isFull) {
      //TODO: Better than JSON.parse / JSON.stringify
      res = Array.from(DatabaseManager.databases.entries()).map(
         ([name, config]) => ({
            name,
            ...JSON.parse(JSON.stringify(config)),
         })
      );
   } else {
      res = Array.from(DatabaseManager.databases.keys());
   }

   if (ctx.query.view) {
      return getTable("Databases" + (isFull ? "" : " small"), res, ctx);
   } else {
      ctx.body = res;
   }
}).post("/database", async (ctx) => {
   const { name, rules, publickey, accesskey, rootkey } = ctx.request.body;

   if (!name) throw new BadRequestError("Name must be set!");

   let db = DatabaseManager.getDatabase(name);
   if (!db) db = await DatabaseManager.addDatabase(name);

   if (publickey) await db.setPublicKey(publickey);

   if (rules) {
      const error = await db.setRules(rules);
      if (error) {
         ctx.status = 500;
         ctx.body = error;
         return;
      }
   }

   if (accesskey) await db.setAccessKey(accesskey);

   if (rootkey) await db.setRootKey(rootkey);

   ctx.body = "Success";
});

AdminRoute.get("/collections", async (ctx) => {
   const { database } = ctx.query;
   let db = DatabaseManager.getDatabase(database as string);
   if (!db) throw new BadRequestError("Database not found");

   let res = await new Promise<string[]>((yes, no) => {
      const stream = db.database.collections.createKeyStream({
         keyAsBuffer: false,
         limit: 1000,
      });
      let res = [];
      stream.on("data", (key: string) => {
         res.push(key);
      });

      stream.on("error", no);
      stream.on("end", () => yes(res));
   });

   if (ctx.query.view) {
      return getTable("Databases", res, ctx);
   } else {
      ctx.body = res;
   }
});

AdminRoute.get("/collections/cleanup", async (ctx) => {
   const { database } = ctx.query;
   let db = DatabaseManager.getDatabase(database as string);
   if (!db) throw new BadRequestError("Database not found");

   let deleted = await db.database.runCleanup();
   if (ctx.query.view) {
      return getTable("Databases", deleted, ctx);
   } else {
      ctx.body = deleted;
   }
});

AdminRoute.get(
   "/database/new",
   getForm("/v1/admin/database", "New Database", {
      name: { label: "Name", type: "text" },
      accesskey: { label: "Access Key", type: "text" },
      rootkey: { label: "Root access key", type: "text" },
      rules: {
         label: "Rules",
         type: "codemirror",
         value: `{\n   ".write": true, \n   ".read": true \n}`,
      },
      publickey: { label: "Public Key", type: "textarea" },
   })
);

AdminRoute.get("/database/update", async (ctx) => {
   const { database } = ctx.query;
   let db = DatabaseManager.getDatabase(database as string);
   if (!db) throw new NotFoundError("Database not found!");
   getForm("/v1/admin/database", "Change Database", {
      name: {
         label: "Name",
         type: "text",
         value: db.name,
         disabled: true,
      },
      accesskey: {
         label: "Access Key",
         type: "text",
         value: db.accesskey,
      },
      rootkey: {
         label: "Root access key",
         type: "text",
         value: db.rootkey,
      },
      rules: {
         label: "Rules",
         type: "codemirror",
         value: db.rules,
      },
      publickey: {
         label: "Public Key",
         type: "textarea",
         value: db.publickey,
      },
   })(ctx);
});

export default AdminRoute;
