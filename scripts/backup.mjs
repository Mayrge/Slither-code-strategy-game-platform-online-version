import { DatabaseSync,backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const database=new DatabaseSync(resolve(root,'data/arena.sqlite'),{readOnly:true});
try{
 const folder=resolve(root,'data/backups');await mkdir(folder,{recursive:true});
 const target=resolve(folder,'arena-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
 await backup(database,target);console.log('数据备份完成：'+target);console.log('包含账户和策略，请保存在私人位置，不要上传GitHub。');
}finally{database.close();}
