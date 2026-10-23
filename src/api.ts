// Shared by the app and the admin console.
export class ApiError extends Error { constructor(message:string,public status:number,public data:unknown){super(message);} }
export async function api<T>(path:string,body?:unknown):Promise<T>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  const timeout=()=>new ApiError('等待服务器超时，请重试',408,null);
  try{
    let response:Response;
    try{response=await fetch('/api'+path,{signal:controller.signal,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});}catch{if(controller.signal.aborted)throw timeout();throw new Error('网络连接暂时中断，请重试');}
    let data:T & {error?:string};
    try{data=await response.json();}catch{if(controller.signal.aborted)throw timeout();throw new ApiError('暂时无法读取服务器响应，请重试',response.status>=500?response.status:502,null);}
    if(!response.ok)throw new ApiError(data.error||'操作失败，请重试',response.status,data);
    return data;
  }finally{clearTimeout(timer);}
}
export function date(text:string){return new Date(text).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});}
