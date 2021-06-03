import { getTemplate } from "./hb";
import { Context } from "vm";

interface IFormConfigField {
   type: "text" | "number" | "boolean" | "textarea" | "codemirror";
   label: string;
   value?: string;
   disabled?: boolean;
}

type IFormConfig = { [name: string]: IFormConfigField };

export default function getForm(
   url: string,
   title: string,
   fieldConfig: IFormConfig
): (ctx: Context) => void {
   let fields = Object.keys(fieldConfig).map((name) => ({
      name,
      ...fieldConfig[name],
      disabled: fieldConfig.disabled ? "disabled" : "",
   }));

   return (ctx) =>
      (ctx.body = getTemplate("forms")({
         url,
         title,
         fields,
      }));
}
