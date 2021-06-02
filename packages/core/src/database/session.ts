export default class Session {
   constructor(private _sessionid: string) {}
   get id() {
      return this._sessionid;
   }
   root: boolean = false;
   uid: string = null;

   subscriptions = new Map<string, () => void>();
}
