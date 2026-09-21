import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

function hex(bytes:Uint8Array){return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");}
async function hmac(secret:string,message:string){
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return hex(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message))));
}
function safeEqual(a:string,b:string){
 if(a.length!==b.length)return false;
 let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);
 return x===0;
}

serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return new Response("Method not allowed",{status:405,headers:cors});
 const auth=req.headers.get("Authorization");
 if(!auth)return new Response(JSON.stringify({error:"Authentication required"}),{status:401,headers:{"Content-Type":"application/json",...cors}});

 const url=Deno.env.get("SUPABASE_URL")!;
 const anon=Deno.env.get("SUPABASE_ANON_KEY")!;
 const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
 const {data:{user}}=await userClient.auth.getUser();
 if(!user)return new Response(JSON.stringify({error:"Invalid session"}),{status:401,headers:{"Content-Type":"application/json",...cors}});

 const body=await req.json();
 const paymentId=String(body.payment_id||"");
 const orderId=String(body.razorpay_order_id||"");
 const razorpayPaymentId=String(body.razorpay_payment_id||"");
 const signature=String(body.razorpay_signature||"");
 if(!paymentId||!orderId||!razorpayPaymentId||!signature)
  return new Response(JSON.stringify({error:"Incomplete payment verification data"}),{status:400,headers:{"Content-Type":"application/json",...cors}});

 const admin=createClient(url,service);
 const {data:payment,error:pe}=await admin.from("payments").select("id,student_id,provider_order_id,status").eq("id",paymentId).single();
 if(pe||!payment)return new Response(JSON.stringify({error:"Payment record not found"}),{status:404,headers:{"Content-Type":"application/json",...cors}});
 if(payment.student_id!==user.id)return new Response(JSON.stringify({error:"Forbidden"}),{status:403,headers:{"Content-Type":"application/json",...cors}});
 if(payment.provider_order_id!==orderId)return new Response(JSON.stringify({error:"Order mismatch"}),{status:400,headers:{"Content-Type":"application/json",...cors}});
 if(payment.status==="paid")return new Response(JSON.stringify({ok:true}),{headers:{"Content-Type":"application/json",...cors}});

 const secret=Deno.env.get("RAZORPAY_KEY_SECRET");
 if(!secret)return new Response(JSON.stringify({error:"Payment gateway is not configured"}),{status:503,headers:{"Content-Type":"application/json",...cors}});
 const expected=await hmac(secret,orderId+"|"+razorpayPaymentId);
 if(!safeEqual(expected,signature))return new Response(JSON.stringify({error:"Payment signature verification failed"}),{status:400,headers:{"Content-Type":"application/json",...cors}});

 const {error:ue}=await admin.from("payments").update({provider_payment_id:razorpayPaymentId,status:"paid",paid_at:new Date().toISOString()}).eq("id",paymentId);
 if(ue)return new Response(JSON.stringify({error:"Could not update payment record"}),{status:500,headers:{"Content-Type":"application/json",...cors}});
 return new Response(JSON.stringify({ok:true}),{headers:{"Content-Type":"application/json",...cors}});
});