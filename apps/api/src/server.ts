import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import session from '@fastify/session'
import csrf from '@fastify/csrf-protection'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { prisma } from '@cms/database'
import { config } from './config.js'
import { authRoutes, requireAdmin } from './auth.js'
import { contentRoutes, publicRoutes } from './routes/content.js'
import { mediaRoutes, serveMedia } from './routes/media.js'
import { categoryRoutes, publicCategoryRoutes } from './routes/categories.js'
import { feedRoutes } from './routes/feeds.js'
import { prerenderRoutes } from './routes/prerender.js'
import { newsBotRoutes } from './routes/news-bot.js'
import { searchConsoleRoutes } from './routes/search-console.js'
import { startNewsBotScheduler, stopNewsBotScheduler } from './news-bot/worker.js'

export async function buildApp() {
  const app=Fastify({logger:{level:config.NODE_ENV==='production'?'info':'debug'},bodyLimit:2*1024*1024,trustProxy:true,ignoreTrailingSlash:true})
  await app.register(helmet,{contentSecurityPolicy:false}); await app.register(cors,{origin:config.ADMIN_ORIGIN,credentials:true}); await app.register(cookie)
  await app.register(session,{secret:config.SESSION_SECRET,cookieName:'cms.sid',cookie:{secure:config.NODE_ENV==='production',httpOnly:true,sameSite:'lax',maxAge:86400000},saveUninitialized:false})
  await app.register(csrf,{sessionPlugin:'@fastify/session'}); await app.register(rateLimit,{global:false}); await app.register(multipart,{limits:{fileSize:config.MAX_UPLOAD_BYTES,files:1}})
  await app.register(swagger,{openapi:{info:{title:'Personal CMS API',version:'1.0.0'},tags:[{name:'public'},{name:'admin'}]}}); await app.register(swaggerUi,{routePrefix:'/docs'})
  app.get('/health',async()=>({status:'ok'})); app.get('/ready',async(_req,reply)=>{try{await prisma.$queryRaw`SELECT 1`;return{status:'ready'}}catch{return reply.code(503).send({status:'unavailable'})}})
  const csrfExemptAdminPaths = new Set(['/auth/login','/auth/forgot-password','/auth/reset-password','/api/admin/auth/login','/api/admin/auth/forgot-password','/api/admin/auth/reset-password','/api/admin/search-console/automation-notify'])
  await app.register(async admin=>{
    admin.addHook('preHandler',(req,reply,done)=>{const path = req.url.split('?')[0] ?? ''; if(['GET','HEAD','OPTIONS'].includes(req.method)||csrfExemptAdminPaths.has(path)) return done(); admin.csrfProtection(req,reply,done)})
    await admin.register(authRoutes,{prefix:'/auth'}); await admin.register(contentRoutes,{prefix:'/content'}); await admin.register(mediaRoutes,{prefix:'/media'}); await admin.register(categoryRoutes,{prefix:'/categories'}); await admin.register(newsBotRoutes,{prefix:'/news-bot'}); await admin.register(searchConsoleRoutes,{prefix:'/search-console'})
    admin.get('/dashboard',{preHandler:requireAdmin},async()=>{const [drafts,published,scheduled,media]=await prisma.$transaction([prisma.content.count({where:{status:'DRAFT'}}),prisma.content.count({where:{status:'PUBLISHED'}}),prisma.content.count({where:{status:'SCHEDULED'}}),prisma.media.count()]); return{data:{drafts,published,scheduled,media}}})
  },{prefix:'/api/admin'})
  await app.register(publicRoutes,{prefix:'/api/v1'}); await app.register(publicCategoryRoutes,{prefix:'/api/v1'}); await app.register(feedRoutes); await app.register(prerenderRoutes); await serveMedia(app)
  app.setErrorHandler((error,_req,reply)=>{app.log.error(error); const status=(error as any).statusCode??500; reply.code(status).send({error:{code:status===500?'INTERNAL_ERROR':'REQUEST_ERROR',message:status===500?'An unexpected error occurred':error instanceof Error?error.message:'Request failed'}})})
  app.addHook('onClose',()=>{stopNewsBotScheduler();return prisma.$disconnect()}); return app
}
if(process.env.NODE_ENV!=='test'){const app=await buildApp(); const shutdown=async()=>{await app.close();process.exit(0)}; process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown); await app.listen({port:config.PORT,host:config.HOST}); await startNewsBotScheduler()}
