import { LoggingBase } from "@hibas123/logging";
import { FileAdapter } from "@hibas123/nodelogging";
import { Context } from "koa";
import config from "../../config";

const route_logging = new LoggingBase({
   name: "access",
   console: config.dev,
});

route_logging.addAdapter(new FileAdapter("logs/access.log"));

const RequestLog = async (ctx: Context, next) => {
   if (!config.access_log) return next();
   let start = process.hrtime();
   let to = false;
   let print = () => {
      let td = process.hrtime(start);
      let time = !to ? (td[0] * 1e3 + td[1] / 1e6).toFixed(2) : "--.--";
      let resColor = "";
      let status = ctx.status;
      if (status >= 200 && status < 300) resColor = "\x1b[32m";
      //Green
      else if (status === 304 || status === 302) resColor = "\x1b[33m";
      else if (status >= 400 && status < 500) resColor = "\x1b[36m";
      //Cyan
      else if (status >= 500 && status < 600) resColor = "\x1b[31m"; //Red
      let m = ctx.method;
      while (m.length < 4) m += " ";
      let message = `${m} ${
         ctx.originalUrl.split("?", 1)[0]
      } ${resColor}${status}\x1b[0m - ${time}ms`;
      route_logging.log(message);
   };
   let timeout = new Promise<void>((yes) =>
      setTimeout(() => (to = true) && yes(), 10000)
   );
   await Promise.race([timeout, next()]);
   print();
};

export default RequestLog;
