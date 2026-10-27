import {hitExcerpt} from '../../lexical.js'
import {documentHash} from './schema.js'
import type {SelectedDocumentChunk} from './selection.js'

/** UTF-16 locators always address the saved original, never normalized text. */
export function documentExcerpt(chunk:SelectedDocumentChunk,query:string,maxChars:number,start?:number){
  let offset=start??0
  if(start===undefined){const found=hitExcerpt(chunk.text,query,Math.max(2,maxChars));offset=chunk.text.indexOf(found)}
  if(offset>0&&/[\uDC00-\uDFFF]/u.test(chunk.text[offset]))offset--
  let end=Math.min(chunk.text.length,offset+Math.max(2,maxChars))
  if(end<chunk.text.length&&/[\uDC00-\uDFFF]/u.test(chunk.text[end]))end--
  if(end===offset&&offset<chunk.text.length)end=Math.min(chunk.text.length,offset+2)
  const text=chunk.text.slice(offset,end)
  return {text,offset,end,span:{...chunk.span,startUtf16:chunk.span.startUtf16+offset,endUtf16:chunk.span.startUtf16+end,quoteSha256:documentHash(text)}}
}
