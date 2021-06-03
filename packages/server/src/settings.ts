import { Lock } from "@hibas123/utils";
import { getRawLevelDB, levelDBResNull } from "@rtdb2/-core";

interface IDatabaseConfig {
   name: string;
   publickey?: string;
   rules?: string;
   accesskey?: string;
   rootkey?: string;
}

class SettingComponent {
   db = getRawLevelDB("databases/_server").data;
   databaseLock = new Lock();

   constructor() {}

   private async setField(name: string, field: string, value: string) {
      return this.db.put("database:" + name + ":" + field, value);
   }

   private async getField(name: string, field: string) {
      return this.db
         .get("database:" + name + ":" + field)
         .then((r) => r.toString())
         .catch(levelDBResNull);
   }

   private getDatabaseList() {
      return this.db
         .get("databases")
         .then((res) => res.toString())
         .then((res) => res.split(":"))
         .catch((err) =>
            err.notFound ? ([] as string[]) : Promise.reject(err)
         );
   }

   async getDatabases() {
      const lock = await this.databaseLock.getLock();

      const databases = await this.getDatabaseList().then((res) =>
         Promise.all(
            res.map(async (database) => {
               let res: IDatabaseConfig = {
                  name: database,
               };
               await Promise.all([
                  this.getField(database, "publickey").then(
                     (r) => (res.publickey = r)
                  ),
                  this.getField(database, "rules").then((r) => (res.rules = r)),
                  this.getField(database, "accesskey").then(
                     (r) => (res.accesskey = r)
                  ),
                  this.getField(database, "rootkey").then(
                     (r) => (res.rootkey = r)
                  ),
               ]);
               return res;
            })
         )
      );

      lock.release();

      return databases;
   }

   // hasDatabase(name: string): boolean {
   //    //TODO may require lock
   //    return this.databases.has(name);
   // }

   async addDatabase(name: string) {
      //TODO: Check for valid name
      if (name.indexOf(":") >= 0)
         throw new Error("Invalid Database name. Cannot contain ':'!");

      const lock = await this.databaseLock.getLock();

      let dbs = await this.getDatabaseList();
      dbs.push(name);
      await this.db.put("databases", dbs.join(":"));

      lock.release();
   }

   async setDatabasePublicKey(name: string, publickey: string) {
      const lock = await this.databaseLock.getLock();

      await this.setField(name, "publickey", publickey);

      lock.release();
   }

   async setDatabaseRules(name: string, rules: string) {
      const lock = await this.databaseLock.getLock();

      await this.setField(name, "rules", rules);

      lock.release();
   }

   async setDatabaseAccessKey(name: string, accesskey: string) {
      const lock = await this.databaseLock.getLock();

      await this.setField(name, "accesskey", accesskey);

      lock.release();
   }

   async setDatabaseRootKey(name: string, accesskey: string) {
      const lock = await this.databaseLock.getLock();

      await this.setField(name, "rootkey", accesskey);

      lock.release();
   }

   async deleteDatabase(name: string) {
      const lock = await this.databaseLock.getLock();

      let pref = "database:" + name;

      let dbs = await this.getDatabaseList().then((res) =>
         res.filter((e) => e !== name)
      );

      await this.db
         .batch()
         .put("databases", dbs.join(":"))
         .del(pref + ":publickey")
         .del(pref + ":rules")
         .del(pref + ":accesskey")
         .del(pref + ":rootkey")
         .write();

      lock.release();
   }
}

const Settings = new SettingComponent();
export default Settings;
