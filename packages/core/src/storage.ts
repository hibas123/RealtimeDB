import * as fs from "fs";
import * as path from "path";
import * as LUR from "levelup";
import * as LDR from "leveldown";

const LevelUp = LUR as any;
const LevelDown = LDR as any;

import type { LevelUp as LU } from "levelup";
import type { LevelDown as LD } from "leveldown";
import { AbstractIterator } from "abstract-leveldown";

export type LevelDB = LU<LD, AbstractIterator<any, any>>;
export type DBSet = { data: LevelDB; collection: LevelDB };

const databases = new Map<string, DBSet>();

export function resNull(err: any): null {
   if (!err.notFound) throw err;
   return null;
}

async function rmRecursice(path: string) {
   if (fs.existsSync(path)) {
      await Promise.all(
         fs.readdirSync(path).map(async (file) => {
            var curPath = path + "/" + file;
            if (fs.lstatSync(curPath).isDirectory()) {
               // recurse
               await rmRecursice(curPath);
            } else {
               // delete file
               await fs.promises.unlink(curPath);
            }
         })
      );
      await fs.promises.rmdir(path);
   }
}

export async function deleteRawLevelDB(db_path: string) {
   db_path = path.resolve(db_path);
   if (!db_path || db_path === "") return;
   let db = databases.get(db_path);

   if (db) {
      if (db.data.isOpen()) await db.data.close();
      if (db.collection.isOpen()) await db.collection.close();
   }

   await rmRecursice(db_path);
}

export function getRawLevelDB(db_path: string): DBSet {
   db_path = path.resolve(db_path);
   let db = databases.get(db_path);
   if (!db) {
      if (!fs.existsSync(db_path)) {
         fs.mkdirSync(db_path, { recursive: true });
      }
   }

   db = {
      data:
         db && db.data.isOpen()
            ? db.data
            : LevelUp(LevelDown(path.join(db_path + "/data"))),
      collection:
         db && db.collection.isOpen()
            ? db.collection
            : LevelUp(LevelDown(path.join(db_path + "/collection"))),
   };

   databases.set(db_path, db);
   return db;
}
