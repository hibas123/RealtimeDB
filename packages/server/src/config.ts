import Logging from "@hibas123/logging";
import * as dotenv from "dotenv";
import { LoggingTypes } from "@hibas123/logging";
dotenv.config();

interface IConfig {
   port: number;
   admin: string;
   access_log: boolean;
   dev: boolean;
}

const config: IConfig = {
   port: Number(process.env.PORT),
   access_log: (process.env.ACCESS_LOG || "").toLowerCase() === "true",
   admin: process.env.ADMIN_KEY,
   dev: (process.env.DEV || "").toLowerCase() === "true",
};

if (config.dev) {
   Logging.logLevel = LoggingTypes.Log;
}

export default config;
