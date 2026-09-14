const express=require("express");
const path=require("path");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Pool}=require("pg");

const app=express();
const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"CHANGE_ME_IN_PRODUCTION";
const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) console.warn("DATABASE_URL não definida. Configure PostgreSQL antes de publicar.");

const pool=new Pool({
 connectionString:DATABASE_URL,
 ssl: process.env.NODE_ENV==="production" ? {rejectUnauthorized:false}:false
});
app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

async function q(text,params=[]){return (await pool.query(text,params)).rows}
async function init(){
 if(!DATABASE_URL)return;
 await pool.query(`
 CREATE TABLE IF NOT EXISTS users(
  id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','viewer')),
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS regions(
  id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS posts(
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS supervisors(
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL,
  access_username TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS routes(
  id BIGSERIAL PRIMARY KEY, route_name TEXT NOT NULL DEFAULT 'Roteiro',
  supervisor_id BIGINT NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  planned INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS visits(
  id BIGSERIAL PRIMARY KEY, route_id BIGINT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 );
 CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);
 CREATE INDEX IF NOT EXISTS idx_routes_supervisor ON routes(supervisor_id);
 CREATE INDEX IF NOT EXISTS idx_routes_post ON routes(post_id);
 `);
 await pool.query(`ALTER TABLE supervisors ADD COLUMN IF NOT EXISTS access_username TEXT NOT NULL DEFAULT ''`);
 const defaultRegions=['RAO','SP','BH','BA','SJRP','USINAS'];
 for(const rg of defaultRegions) await pool.query(`INSERT INTO regions(name) VALUES($1) ON CONFLICT (name) DO NOTHING`,[rg]);
 await pool.query(`ALTER TABLE routes ADD COLUMN IF NOT EXISTS route_name TEXT NOT NULL DEFAULT 'Roteiro'`);
 // Migration from the previous version: allow more than one named route for the same supervisor/post.
 await pool.query(`ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_supervisor_id_post_id_key`);
 // Garante o acesso MASTER solicitado: admin / admin.
 const hash=await bcrypt.hash("admin",12);
 await q(`
   INSERT INTO users(username,password_hash,name,role,active)
   VALUES('admin',$1,'Administrador','admin',true)
   ON CONFLICT (username) DO UPDATE SET
     password_hash=EXCLUDED.password_hash,
     name='Administrador',
     role='admin',
     active=true
 `,[hash]);
}
function auth(req,res,next){
 const token=(req.headers.authorization||"").replace(/^Bearer\s+/,"");
 try{req.user=jwt.verify(token,JWT_SECRET);next()}catch{res.status(401).json({error:"Sessão inválida ou expirada."})}
}
function admin(req,res,next){if(req.user.role!=="admin")return res.status(403).json({error:"Permissão de administrador necessária."});next()}
function validText(v){return typeof v==='string' && v.trim().length>0}

app.post("/api/login",async(req,res)=>{
 try{
  const username=String((req.body||{}).username||"").trim();
  const password=String((req.body||{}).password||"");
  if(!username||!password)return res.status(400).json({error:"Informe usuário e senha."});
  const rows=await q("SELECT * FROM users WHERE lower(username)=lower($1) AND active=true",[username]);
  if(!rows.length||!(await bcrypt.compare(password,rows[0].password_hash)))return res.status(401).json({error:"Usuário ou senha inválidos."});
  const u=rows[0], token=jwt.sign({id:u.id,username:u.username,name:u.name,role:u.role},JWT_SECRET,{expiresIn:"8h"});
  res.json({token,user:{id:u.id,username:u.username,name:u.name,role:u.role}});
 }catch(e){res.status(500).json({error:"Falha no login."})}
});

app.get("/api/bootstrap",auth,async(req,res)=>{
 try{
  const [posts,supervisors,routes,visits,users,regionRows,dbRegions]=await Promise.all([
   q("SELECT id,name,region FROM posts WHERE active=true ORDER BY name"),
   q("SELECT id,name,region,access_username FROM supervisors WHERE active=true ORDER BY region,name"),
   q("SELECT id,route_name,supervisor_id,post_id,planned FROM routes ORDER BY route_name,id"),
   q("SELECT id,route_id,to_char(visit_date,'YYYY-MM-DD') visit_date FROM visits ORDER BY visit_date"),
   req.user.role==="admin"?q("SELECT id,username,name,role,active,created_at FROM users ORDER BY name"):Promise.resolve([]),
   q("SELECT region FROM posts WHERE active=true UNION SELECT region FROM supervisors WHERE active=true ORDER BY 1"),
   q("SELECT name FROM regions ORDER BY name")
  ]);
  const regions=[...new Set([...dbRegions.map(x=>x.name),...regionRows.map(x=>x.region).filter(Boolean)])];
  res.json({posts,supervisors,routes,visits,users,regions});
 }catch(e){console.error(e);res.status(500).json({error:"Erro ao carregar dados."})}
});


app.post("/api/regions",auth,admin,async(req,res)=>{
 const name=(req.body.name||"").trim();
 if(!validText(name))return res.status(400).json({error:"Nome da regional é obrigatório."});
 try{const x=await q("INSERT INTO regions(name) VALUES($1) RETURNING id,name",[name]);res.json(x[0]);}
 catch(e){if(e.code==="23505")return res.status(409).json({error:"Esta regional já existe."});throw e}
});
app.put("/api/regions",auth,admin,async(req,res)=>{
 const oldName=(req.body.old_name||"").trim(),name=(req.body.name||"").trim();
 if(!validText(oldName)||!validText(name))return res.status(400).json({error:"Regional antiga e nova são obrigatórias."});
 try{
  await pool.query("BEGIN");
  await q("UPDATE regions SET name=$1 WHERE name=$2",[name,oldName]);
  await q("UPDATE posts SET region=$1 WHERE region=$2",[name,oldName]);
  await q("UPDATE supervisors SET region=$1 WHERE region=$2",[name,oldName]);
  await pool.query("COMMIT");res.json({ok:true});
 }catch(e){await pool.query("ROLLBACK");if(e.code==="23505")return res.status(409).json({error:"A regional informada já existe."});throw e}
});
app.delete("/api/regions",auth,admin,async(req,res)=>{
 const name=(req.body.name||"").trim();
 if(!validText(name))return res.status(400).json({error:"Regional é obrigatória."});
 const used=(await q("SELECT (SELECT count(*) FROM posts WHERE region=$1)::int + (SELECT count(*) FROM supervisors WHERE region=$1)::int AS c",[name]))[0];
 if(Number(used.c)>0)return res.status(400).json({error:"A regional está vinculada a postos ou supervisores. Transfira os cadastros antes de excluir."});
 await q("DELETE FROM regions WHERE name=$1",[name]);res.json({ok:true});
});

app.post("/api/posts",auth,admin,async(req,res)=>{
 const name=(req.body.name||"").trim(),region=(req.body.region||"").trim();
 if(!validText(name)||!validText(region))return res.status(400).json({error:"Nome e regional são obrigatórios."});
 const x=await q("INSERT INTO posts(name,region) VALUES($1,$2) RETURNING id,name,region",[name,region]);res.json(x[0]);
});
app.put("/api/posts/:id",auth,admin,async(req,res)=>{
 const name=(req.body.name||"").trim(),region=(req.body.region||"").trim();
 if(!validText(name)||!validText(region))return res.status(400).json({error:"Nome e regional são obrigatórios."});
 await q("UPDATE posts SET name=$1,region=$2 WHERE id=$3",[name,region,req.params.id]);res.json({ok:true});
});
app.delete("/api/posts/:id",auth,admin,async(req,res)=>{await q("DELETE FROM posts WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.post("/api/supervisors",auth,admin,async(req,res)=>{
 const name=(req.body.name||"").trim(),region=(req.body.region||"").trim(),access_username=(req.body.access_username||"").trim();
 if(!validText(name)||!validText(region))return res.status(400).json({error:"Nome e regional são obrigatórios."});
 const x=await q("INSERT INTO supervisors(name,region,access_username) VALUES($1,$2,$3) RETURNING id,name,region,access_username",[name,region,access_username]);res.json(x[0]);
});
app.put("/api/supervisors/:id",auth,admin,async(req,res)=>{
 const name=(req.body.name||"").trim(),region=(req.body.region||"").trim(),access_username=(req.body.access_username||"").trim();
 if(!validText(name)||!validText(region))return res.status(400).json({error:"Nome e regional são obrigatórios."});
 await q("UPDATE supervisors SET name=$1,region=$2,access_username=$3 WHERE id=$4",[name,region,access_username,req.params.id]);res.json({ok:true});
});
app.delete("/api/supervisors/:id",auth,admin,async(req,res)=>{await q("DELETE FROM supervisors WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.post("/api/routes",auth,admin,async(req,res)=>{
 const route_name=(req.body.route_name||"").trim()||"Roteiro";
 const {supervisor_id,post_id,planned}=req.body;
 const x=await q(`INSERT INTO routes(route_name,supervisor_id,post_id,planned) VALUES($1,$2,$3,$4) RETURNING *`,[route_name,supervisor_id,post_id,Number(planned)||0]);res.json(x[0]);
});
app.put("/api/routes/:id",auth,admin,async(req,res)=>{
 const route_name=(req.body.route_name||"").trim()||"Roteiro";
 await q("UPDATE routes SET route_name=$1,supervisor_id=$2,post_id=$3,planned=$4 WHERE id=$5",[route_name,req.body.supervisor_id,req.body.post_id,Number(req.body.planned)||0,req.params.id]);res.json({ok:true});
});
app.delete("/api/routes/:id",auth,admin,async(req,res)=>{await q("DELETE FROM routes WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.post("/api/routes/:id/visits",auth,admin,async(req,res)=>{
 const d=req.body.visit_date;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d||""))return res.status(400).json({error:"Data inválida."});
 const x=await q("INSERT INTO visits(route_id,visit_date) VALUES($1,$2) RETURNING id,route_id,to_char(visit_date,'YYYY-MM-DD') visit_date",[req.params.id,d]);res.json(x[0]);
});
app.delete("/api/visits/:id",auth,admin,async(req,res)=>{await q("DELETE FROM visits WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.post("/api/users",auth,admin,async(req,res)=>{
 const {username,password,name,role}=req.body||{};
 if(!username||!password||!name)return res.status(400).json({error:"Usuário, senha e nome são obrigatórios."});
 const hash=await bcrypt.hash(password,12);
 const x=await q("INSERT INTO users(username,password_hash,name,role) VALUES($1,$2,$3,$4) RETURNING id,username,name,role,active",[username.trim(),hash,name.trim(),role==="admin"?"admin":"viewer"]);
 res.json(x[0]);
});
app.put("/api/users/:id",auth,admin,async(req,res)=>{
 const {name,role,active}=req.body;
 await q("UPDATE users SET name=$1,role=$2,active=$3 WHERE id=$4",[name,role==="admin"?"admin":"viewer",!!active,req.params.id]);res.json({ok:true});
});
app.delete("/api/users/:id",auth,admin,async(req,res)=>{
 const x=(await q("SELECT role FROM users WHERE id=$1",[req.params.id]))[0];
 if(x?.role==="admin" && (await q("SELECT count(*)::int c FROM users WHERE role='admin' AND active=true"))[0].c<=1)return res.status(400).json({error:"Mantenha pelo menos um administrador ativo."});
 await q("DELETE FROM users WHERE id=$1",[req.params.id]);res.json({ok:true});
});

app.get("/api/health",async(req,res)=>{try{await q("SELECT 1");res.json({ok:true,db:true})}catch{res.status(503).json({ok:false,db:false})}});
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

init().then(()=>app.listen(PORT,()=>console.log("Resolv Tech // Visitas Operacionais: "+PORT)))
.catch(e=>{console.error(e);process.exit(1)});
