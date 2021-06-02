import * as koa from "koa";
import * as BodyParser from "koa-body";
import RequestLog from "./helper/log";
import RequestError from "./helper/error";
import V1 from "./v1";

const Web = new koa();

Web.use(RequestLog);
Web.use(RequestError);
Web.use(BodyParser({}));

Web.use(V1.routes());
Web.use(V1.allowedMethods());

export default Web;