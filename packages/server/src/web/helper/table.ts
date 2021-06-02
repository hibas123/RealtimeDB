import { Context } from "koa";
import { getTemplate } from "./hb";

export default function getTable(title: string, data: any[], ctx: Context) {
   let table: string[][] = [];

   if (data.length > 0) {
      if (typeof data[0] !== "object") {
         table = [["value"], ...data.map(value => [value.toString()])];
      } else {
         if (Array.isArray(data[0])) {
            table = data.map(row => row.map(col => col.toString()));
         } else {
            let fields = new Set<string>();
            data.forEach(val => Object.keys(val).forEach(key => fields.add(key)))

            let f = Array.from(fields.keys());

            table = [f, ...data.map(value => f.map(key => value[key]))];
         }
      }
   }
   ctx.body = getTemplate("tables")({
      title,
      table,
      empty: table.length <= 0
   });
}