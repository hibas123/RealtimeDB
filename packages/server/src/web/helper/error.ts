import { HttpError, HttpStatusCode } from "./errors";
import Logging from "@hibas123/logging";
import { Context } from "koa";
export default function RequestError(ctx: Context, next) {
   function reply(status, message) {
      ctx.status = status;
      ctx.body = message;
   }

   return next()
      .then(() => {
         if (ctx.status === HttpStatusCode.NOT_FOUND) {
            reply(HttpStatusCode.NOT_FOUND, "Not found");
         }
      })
      .catch((error) => {
         let message = "Internal server error";
         let status = HttpStatusCode.INTERNAL_SERVER_ERROR;
         if (typeof error === "string") {
            message = error;
         } else if (!(error instanceof HttpError)) {
            Logging.error(error);
            message = error.message;
         } else {
            if (error.status === HttpStatusCode.INTERNAL_SERVER_ERROR) {
               //If internal server error log whole error
               Logging.error(error);
            } else {
               message = error.message.split("\n", 1)[0];
               Logging.error(message);
            }
            status = error.status;
         }
         reply(status, message);
      });
}
