import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { db, migrate } from '../server/db.mjs';

const email=String(process.argv[2]||'').trim().toLowerCase();

const readHiddenPassword = prompt => new Promise((resolve,reject)=>{
  stdout.write(prompt);
  if(!stdin.isTTY) return reject(new Error('Ejecuta este comando en una terminal interactiva.'));
  const previousRaw=stdin.isRaw;
  stdin.setRawMode(true);stdin.resume();
  let value='';
  const finish=error=>{stdin.removeListener('data',onData);stdin.setRawMode(previousRaw||false);stdin.pause();stdout.write('\n');error?reject(error):resolve(value);};
  const onData=chunk=>{for(const char of String(chunk)){if(char==='\u0003')return finish(new Error('Operación cancelada.'));if(char==='\r'||char==='\n')return finish();if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else value+=char;}};
  stdin.on('data',onData);
});

try {
  migrate();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Uso: npm run reset-password -- correo@ejemplo.com');
  const user=db.prepare('SELECT id,email FROM users WHERE email=? AND is_active=1').get(email);
  if(!user) throw new Error('No existe una cuenta activa con ese correo.');
  const password=await readHiddenPassword('Nueva contraseña (12 caracteres mínimo): ');
  const confirmation=await readHiddenPassword('Confirma la nueva contraseña: ');
  if(password.length<12||password.length>200) throw new Error('La contraseña debe tener entre 12 y 200 caracteres.');
  if(password!==confirmation) throw new Error('Las contraseñas no coinciden.');
  const hash=await bcrypt.hash(password,12);
  db.transaction(()=>{
    db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(hash,new Date().toISOString(),user.id);
    db.prepare('DELETE FROM sessions').run();
  })();
  console.log(`Contraseña actualizada: ${user.email}`);
} catch(e) {
  console.error(e.message);
  process.exitCode=1;
} finally {
  db.close();
}
