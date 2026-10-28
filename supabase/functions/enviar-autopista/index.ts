// Correo a cada ITO con las fallas de luminarias de la Autopista Vespucio Sur que registró y aún no ha reenviado.
// Lo llama pg_cron de lunes a viernes; solo envía si en Chile son las 9:00. Es automático: no requiere botón ni sesión.
// Secretos necesarios (Edge Functions > Secrets): GMAIL_USER y GMAIL_APP_PASSWORD (contraseña de aplicación de Gmail).
import nodemailer from "npm:nodemailer@6.9.13";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "—").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmtFecha = (iso: string) => new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const modo = "diario";
  const ahora = new Date();
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Santiago", hour: "2-digit", hour12: false }).format(ahora)) % 24;
  const dia = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", weekday: "short" }).format(ahora);
  if (hora !== 9 || dia === "Sat" || dia === "Sun") return json(200, { omitido: true, hora, dia });

  const gmail = Deno.env.get("GMAIL_USER"), clave = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!gmail || !clave) return json(500, { error: "Faltan los secretos GMAIL_USER y GMAIL_APP_PASSWORD" });
  const correo = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: gmail, pass: clave } });

  const { data: grupos, error } = await admin.rpc("autopista_pendientes_envio", { p_usuario: null });
  if (error) return json(500, { error: error.message });

  const resultado: unknown[] = [];
  for (const g of (grupos || []) as any[]) {
    const ids = g.fallas.map((f: any) => f.id);
    if (!g.email || !ids.length) continue;
    const n = ids.length;
    const filasTxt = g.fallas.map((f: any) => `- ${f.placa} · ${f.tipo_falla}${f.descripcion ? " (" + f.descripcion + ")" : ""} · OS ${f.ot || "—"}${f.orden_externa ? " / " + f.orden_externa : ""} · ${fmtFecha(f.fecha_falla)} · llave ${f.llave ?? "—"} · https://www.google.com/maps?q=${f.lat},${f.lon}`).join("\n");
    const filasHtml = g.fallas.map((f: any) => `<tr><td><b>${esc(f.placa)}</b></td><td>${esc(f.tipo_falla)}${f.descripcion ? "<br><small>" + esc(f.descripcion) + "</small>" : ""}</td><td>${esc(f.ot)}${f.orden_externa ? "<br><small>" + esc(f.orden_externa) + "</small>" : ""}</td><td>${esc(fmtFecha(f.fecha_falla))}</td><td>${esc(f.llave)}</td><td><a href="https://www.google.com/maps?q=${f.lat},${f.lon}">Ver mapa</a></td></tr>`).join("");
    const asunto = `Alumbrado Público · ${n} falla${n > 1 ? "s" : ""} en luminarias de Autopista Vespucio Sur por reenviar`;
    const texto = `Hola ${g.nombre || ""},\n\nEstas son las fallas que registraste en luminarias de la Autopista Vespucio Sur (sin mantenimiento municipal), para reenviar a la concesionaria:\n\n${filasTxt}\n\nAlumbrado Público · Dirección de Obras Municipales · Municipalidad de La Florida`;
    const html = `<p>Hola ${esc(g.nombre)},</p><p>Estas son las fallas que registraste en luminarias de la <b>Autopista Vespucio Sur</b> (sin mantenimiento municipal), para reenviar a la concesionaria:</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;border-color:#c9d3dc;font-size:13px"><tr style="background:#1f3a5f;color:#fff"><th>Placa</th><th>Falla</th><th>OS</th><th>Fecha informada</th><th>Llave</th><th>Ubicación</th></tr>${filasHtml}</table>
<p style="color:#6c7f94">Alumbrado Público · Dirección de Obras Municipales · Municipalidad de La Florida</p>`;
    try {
      await correo.sendMail({ from: `Alumbrado Público La Florida <${gmail}>`, to: g.email, subject: asunto, text: texto, html });
      await admin.rpc("autopista_marcar_enviadas", { p_ids: ids, p_usuario: g.usuario_id, p_modo: modo, p_ok: true, p_error: null });
      resultado.push({ usuario: g.nombre, enviadas: n });
    } catch (e) {
      await admin.rpc("autopista_marcar_enviadas", { p_ids: ids, p_usuario: g.usuario_id, p_modo: modo, p_ok: false, p_error: String(e) });
      resultado.push({ usuario: g.nombre, error: String(e) });
    }
  }
  return json(200, { modo, resultado });
});
