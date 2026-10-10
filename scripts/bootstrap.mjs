import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
const url=process.argv[2];
if(!url){console.error('用法：pnpm bootstrap https://你的站点.workers.dev');process.exit(1);}
const rl=createInterface({input:stdin,output:stdout});
try{
  const token=await rl.question('一次性初始化凭证：');
  const username=await rl.question('管理员用户名：');
  console.log('为了保护密码，请在网页初始化入口中设置密码。');
  console.log(`${new URL('/setup',url).href}#${encodeURIComponent(token)}`);
  console.log(`在页面中填写用户名 ${username} 与自己的密码。管理员只能初始化一次。`);
}finally{rl.close();}
