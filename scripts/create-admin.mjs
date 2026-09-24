import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, migrate } from '../server/db.mjs';

migrate();
const readHiddenPassword = () => new Promise((resolve,reject)=>{
  stdout.write('Contraseña (12 caracteres mínimo): ');
  const previousRaw=stdin.isRaw;
  stdin.setRawMode(true);stdin.resume();
  let value='';
  const finish=error=>{stdin.removeListener('data',onData);stdin.setRawMode(previousRaw||false);stdin.pause();stdout.write('\n');error?reject(error):resolve(value);};
  const onData=chunk=>{for(const char of String(chunk)){if(char==='\u0003')return finish(new Error('Operación cancelada.'));if(char==='\r'||char==='\n')return finish();if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else value+=char;}};
  stdin.on('data',onData);
});

try {
  let fullName,email,password;
  if(stdin.isTTY){
    const rl=createInterface({input:stdin,output:stdout});
    fullName=(await rl.question('Nombre del administrador: ')).trim().replace(/\s+/g,' ');
    email=(await rl.question('Email: ')).trim().toLowerCase();
    rl.close();password=await readHiddenPassword();
  }else{
    stdout.write('Nombre del administrador:\nEmail:\nContraseña (12 caracteres mínimo):\n');
    let input='';for await(const chunk of stdin)input+=String(chunk);
    [fullName='',email='',password='']=input.split(/\r?\n/);fullName=fullName.trim().replace(/\s+/g,' ');email=email.trim().toLowerCase();password=password.trim();
  }
  if(fullName.length<2||fullName.length>120||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12) throw new Error('Nombre, email o contraseña inválidos.');
  const hash=await bcrypt.hash(password,12);
  db.prepare("INSERT INTO users(id,email,password_hash,full_name,role) VALUES(?,?,?,?,'admin')").run(randomUUID(),email,hash,fullName);
  console.log(`Administrador creado: ${email}`);
} catch(e) { console.error(e.message); process.exitCode=1; }
finally { db.close(); }
