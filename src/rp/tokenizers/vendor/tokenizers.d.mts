/** Narrow integration surface of Apache-2.0 @huggingface/tokenizers 0.2.0. */
export class Tokenizer {
  constructor(data:object,config:object)
  encode(text:string,options?:{add_special_tokens?:boolean}):{ids:number[]}
}
