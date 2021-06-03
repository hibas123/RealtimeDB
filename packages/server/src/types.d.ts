declare module "what-the-pack" {
    namespace whatthepack {
        function initialize(bufferSize: number): {
            encode(data: any): Buffer;
            decode<T>(data: Buffer): T;
            Buffer: typeof global.Buffer
        }
    }
    export = whatthepack;
}