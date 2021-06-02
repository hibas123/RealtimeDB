import * as Handlebars from "handlebars";
import { readFileSync } from "fs";
import config from "../../config";
import Logging from "@hibas123/logging";

function checkCondition(v1, operator, v2) {
   switch (operator) {
      case "==":
         return v1 == v2;
      case "===":
         return v1 === v2;
      case "!==":
         return v1 !== v2;
      case "<":
         return v1 < v2;
      case "<=":
         return v1 <= v2;
      case ">":
         return v1 > v2;
      case ">=":
         return v1 >= v2;
      case "&&":
         return v1 && v2;
      case "||":
         return v1 || v2;
      default:
         return false;
   }
}

Handlebars.registerHelper("ifCond", function (v1, operator, v2, options) {
   return checkCondition(v1, operator, v2)
      ? options.fn(this)
      : options.inverse(this);
});

const cache = new Map<string, Handlebars.TemplateDelegate>();
const htmlCache = new Map<string, string>();

export function getView(name: string) {
   let tl: string;
   if (!config.dev) tl = htmlCache.get(name);

   if (!tl) {
      tl = readFileSync(`./views/${name}.html`).toString();
      htmlCache.set(name, tl);
   }

   return tl;
}

export function getTemplate(name: string) {
   let tl: Handlebars.TemplateDelegate;
   if (!config.dev) tl = cache.get(name);

   if (!tl) {
      Logging.debug("Recompiling template!");
      tl = Handlebars.compile(readFileSync(`./views/${name}.hbs`).toString());
      cache.set(name, tl);
   }

   return tl;
}
