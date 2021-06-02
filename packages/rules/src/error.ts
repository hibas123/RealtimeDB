export interface RuleError {
   line: number;
   column: number;
   message: string;
   original_err: Error;
}

function indexToLineAndCol(src: string, index: number) {
   let line = 1;
   let col = 1;
   for (let i = 0; i < index; i++) {
      if (src.charAt(i) === "\n") {
         line++;
         col = 1;
      } else {
         col++;
      }
   }

   return { line, col };
}

export function transformError(
   err: Error,
   data: string,
   idx: number
): RuleError {
   let loc = indexToLineAndCol(data, idx);

   return {
      line: loc.line,
      column: loc.col,
      message: err.message,
      original_err: err,
   };
}
