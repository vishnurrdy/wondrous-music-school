import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return new Response("Method not allowed",{status:405,headers:cors});

  const auth = req.headers.get("Authorization");
  if (!auth) return new Response(JSON.stringify({error:"Authentication required"}),{status:401,headers:{"Content-Type":"application/json",...cors}});

  const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
  const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET)
    return new Response(JSON.stringify({error:"Payment gateway is not configured"}),{status:503,headers:{"Content-Type":"application/json",...cors}});

  const body = await req.json();
  const amount = Number(body.amount_inr);
  if (!Number.isInteger(amount) || amount <= 0)
    return new Response(JSON.stringify({error:"Invalid amount"}),{status:400,headers:{"Content-Type":"application/json",...cors}});

  const receipt = "WMS_" + crypto.randomUUID().replaceAll("-","").slice(0,20);
  const basic = btoa(RAZORPAY_KEY_ID + ":" + RAZORPAY_KEY_SECRET);
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method:"POST",
    headers:{"Authorization":"Basic "+basic,"Content-Type":"application/json"},
    body:JSON.stringify({amount:amount*100,currency:"INR",receipt,notes:{school:"Wondrous Music School"}})
  });

  const data = await response.json();
  if (!response.ok) return new Response(JSON.stringify({error:"Gateway order creation failed",details:data}),{status:502,headers:{"Content-Type":"application/json",...cors}});
  return new Response(JSON.stringify({key_id:RAZORPAY_KEY_ID,order:data}),{headers:{"Content-Type":"application/json",...cors}});
});
