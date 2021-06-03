export type Release = { release: () => void };

export default class DocumentLock {
   private locks = new Map<string, (() => void)[]>();

   getLocks() {
      return Array.from(this.locks.keys());
   }

   async lock(collection: string = "", document: string = "") {
      //TODO: Check collection locks
      let key = collection + "/" + document;
      let l = this.locks.get(key);
      if (l)
         await new Promise<void>((resolve) => {
            l.push(resolve);
            this.locks.set(key, l);
         });
      else {
         l = [];
         this.locks.set(key, l);
      }

      return () => {
         if (l.length > 0) setImmediate(() => l.shift()());
         else this.locks.delete(key);
      };
   }
}
