import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};

serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return new Response("Method not allowed",{status:405,headers:cors});

  const auth=req.headers.get("Authorization");
  if(!auth) return new Response(JSON.stringify({error:"Authentication required"}),{status:401,headers:{"Content-Type":"application/json",...cors}});

  const url=Deno.env.get("SUPABASE_URL")!;
  const anon=Deno.env.get("SUPABASE_ANON_KEY")!;
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:ue}=await userClient.auth.getUser();
  if(ue||!user) return new Response(JSON.stringify({error:"Invalid session"}),{status:401,headers:{"Content-Type":"application/json",...cors}});

  const body=await req.json();
  const enrollmentId=String(body.enrollment_id||"");
  if(!enrollmentId) return new Response(JSON.stringify({error:"enrollment_id is required"}),{status:400,headers:{"Content-Type":"application/json",...cors}});

  const admin=createClient(url,service);
  const {data:enrollment,error:ee}=await admin.from("enrollments").select("id,student_id,fee_inr,status").eq("id",enrollmentId).single();
  if(ee||!enrollment) return new Response(JSON.stringify({error:"Enrollment not found"}),{status:404,headers:{"Content-Type":"application/json",...cors}});
  if(enrollment.student_id!==user.id) return new Response(JSON.stringify({error:"Forbidden"}),{status:403,headers:{"Content-Type":"application/json",...cors}});
  if(!["pending","active"].includes(enrollment.status)) return new Response(JSON.stringify({error:"This enrollment is not payable"}),{status:400,headers:{"Content-Type":"application/json",...cors}});

  const key=Deno.env.get("RAZORPAY_KEY_ID");
  const secret=Deno.env.get("RAZORPAY_KEY_SECRET");
  if(!key||!secret) return new Response(JSON.stringify({error:"Payment gateway is not configured"}),{status:503,headers:{"Content-Type":"application/json",...cors}});

  const amount=Number(enrollment.fee_inr);
  if(!Number.isInteger(amount)||amount<=0) return new Response(JSON.stringify({error:"Invalid enrollment fee"}),{status:400,headers:{"Content-Type":"application/json",...cors}});

  const receipt="WMS_"+crypto.randomUUID().replaceAll("-","").slice(0,20);
  const basic=btoa(key+":"+secret);
  const gateway=await fetch("https://api.razorpay.com/v1/orders",{method:"POST",headers:{"Authorization":"Basic "+basic,"Content-Type":"application/json"},body:JSON.stringify({amount:amount*100,currency:"INR",receipt,notes:{school:"Wondrous Music School",student_id:user.id,enrollment_id:enrollmentId}})});
  const order=await gateway.json();
  if(!gateway.ok) return new Response(JSON.stringify({error:"Gateway order creation failed"}),{status:502,headers:{"Content-Type":"application/json",...cors}});

  const {data:payment,error:pe}=await admin.from("payments").insert({student_id:user.id,enrollment_id:enrollmentId,amount_inr:amount,provider:"razorpay",provider_order_id:order.id,receipt,status:"pending"}).select("id,receipt,amount_inr,status").single();
  if(pe) return new Response(JSON.stringify({error:"Payment record could not be created"}),{status:500,headers:{"Content-Type":"application/json",...cors}});

  return new Response(JSON.stringify({key_id:key,order,payment}),{headers:{"Content-Type":"application/json",...cors}});
});