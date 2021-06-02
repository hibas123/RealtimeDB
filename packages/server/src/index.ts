import Logging from "@hibas123/logging";
import Web from "./web";
import config from "./config";
import { DatabaseManager } from "./database";
import { createServer } from "http";
import { WebsocketConnectionManager } from "./websocket";
import { LoggingTypes } from "@hibas123/logging";
import * as fs from "fs";

if (!fs.existsSync("./databases/")) {
   fs.mkdirSync("./databases");
}

Logging.logLevel = config.dev ? LoggingTypes.Debug : LoggingTypes.Log;

const version = JSON.parse(
   fs.readFileSync("./package.json").toString()
).version;

Logging.log("Starting Database version:", version);

DatabaseManager.init()
   .then(() => {
      const http = createServer(Web.callback());
      WebsocketConnectionManager.bind(http);
      const port = config.port || 5000;
      http.listen(port, () => Logging.log("WS:  Listening on port:", port));
   })
   .catch((err) => {
      Logging.error(err);
      process.exit(-1);
   });
