import Settings from "./settings";
import nanoid = require("nanoid");

import { Database } from "@rtdb2/core";
import compileRule, { RuleError } from "@rtdb2/rules";
import Logging from "@hibas123/logging";

export class DatabaseManager {
   static databases = new Map<string, DatabaseWrapper>();

   static async init() {
      let databases = await Settings.getDatabases();

      databases.forEach((dbconfig) => {
         let db = new DatabaseWrapper(
            dbconfig.name,
            dbconfig.accesskey,
            dbconfig.rules,
            dbconfig.publickey,
            dbconfig.rootkey
         );
         this.databases.set(dbconfig.name, db);
      });
   }

   static async addDatabase(name: string) {
      if (this.databases.has(name)) throw new Error("Database already exists!");

      await Settings.addDatabase(name);
      let database = new DatabaseWrapper(name);
      this.databases.set(name, database);
      return database;
   }

   static getDatabase(name: string) {
      return this.databases.get(name);
   }

   static async deleteDatabase(name: string) {
      let db = this.databases.get(name);
      if (db) {
         await Settings.deleteDatabase(name);
         await db.database.delete();
      }
   }
}

export class DatabaseWrapper {
   #database: Database;

   get database() {
      return this.#database;
   }

   constructor(
      public name: string,
      public accesskey?: string,
      public rules?: string,
      public publickey?: string,
      public rootkey?: string
   ) {
      this.rules = rules;
      this.#database = new Database("./databases/" + name, {
         // Set blocking rule at the start
         hasPermission: () => false,
      });

      if (rules) this.applyRules(rules);
   }

   private applyRules(rules: string): undefined | RuleError {
      try {
         JSON.parse(rules);
         Logging.warning(
            "Found old rule! Replacing with a 100% permissive one!"
         );
         rules =
            "service realtimedb {\n   match /* {\n      allow read, write, list: if false; \n   }\n}";
         // still json, so switching to new format
      } catch (err) {}

      let { runner, error } = compileRule(rules);
      if (error) {
         Logging.warning("Found error in existing config!", error);
         runner = compileRule("service realtimesb {}").runner;
      }
      this.rules = rules;
      this.#database.rules = runner;
      return undefined;
   }

   async setRules(rules: string): Promise<RuleError | undefined> {
      const { runner, error } = compileRule(rules);
      if (error) return error;
      await Settings.setDatabaseRules(this.name, rules);
      this.rules = rules;
      this.#database.rules = runner;
   }

   async setAccessKey(key: string) {
      await Settings.setDatabaseAccessKey(this.name, key);
      this.accesskey = key;
   }

   async setRootKey(key: string) {
      await Settings.setDatabaseRootKey(this.name, key);
      this.rootkey = key;
   }

   async setPublicKey(key: string) {
      await Settings.setDatabasePublicKey(this.name, key);
      this.publickey = key;
   }
}
