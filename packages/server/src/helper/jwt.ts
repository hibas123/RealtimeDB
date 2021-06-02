import * as JWT from "jsonwebtoken";

export async function verifyJWT(token: string, publicKey: string) {
   return new Promise<any | undefined>((yes) => {
      JWT.verify(token, publicKey, (err, decoded) => {
         if (err)
            yes(undefined);
         else
            yes(decoded);
      })
   })
}