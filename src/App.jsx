import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { parseSharpened } from "./mi-session.js";


// The way back to the app, from the header and from the end of every result.
const DASHBOARD_URL = "https://app.management-ignition.com/";
// PDF file names: tool, person, then what the work is about, so a saved file says what it is.
const pdfName = (...parts) => parts
  .map(s => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim())
  .filter(Boolean).join(" - ") + ".pdf";

const supabase = createClient(
  "https://fdiitxhgfytvlbtokbok.supabase.co",
  "sb_publishable_JQMFDaTz5g-2ZlitosUTeA_C9B48-Lc"
);

// Management Ignition design system, 4 October 2026. Same names, new values.
// Teal (accent) is the method speaking: never a button fill, never a link.
// The tool colour is an identity mark only: the 3px top line. RED_LIGHT and
// RED_DARK stay defined for the names but no longer appear in the UI.
const RED = "#f44336";        // Meeting Ignite tool colour
const RED_LIGHT = "#fdecea";
const RED_DARK = "#c62828";

const COLORS = {
  navy: "#1b2a4a",            // ink: headlines, primary buttons
  navyMid: "#2a3d63",         // ink-2: body copy
  red: RED, redLight: RED_LIGHT, redDark: RED_DARK,
  slate: "#5d6b7f", slateLight: "#f6f8fb",
  border: "#e2e7ee", text: "#1b2a4a", muted: "#5d6b7f",
  white: "#ffffff", amber: "#8a5300", amberLight: "#fff3e0",
  red2: "#b3261e",            // danger
  green: "#1e6b45", greenLight: "#e8f4ec",
  blue: "#2a3d63", blueLight: "#eef2f6",
  teal: "#0e7c7b",            // accent
  tealLight: "#e9f3f3",       // accent-soft; text on it is ink
  canvas: "#f6f8fb",
  sunk: "#eef2f6",
  tool: RED,
};

const FONT = {
  sans: '"Instrument Sans", -apple-system, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif',
  spoken: 'Fraunces, "Iowan Old Style", Georgia, serif',
};
const SHADOW = "0 1px 2px rgba(27,42,74,0.05), 0 18px 44px -28px rgba(27,42,74,0.30)";

// ─── Meeting type config ──────────────────────────────────────────────────────

const MEETING_TYPES = {
  team: {
    label: "Team meeting",
    desc: "Regular team alignment, decisions, and updates.",
    recommendedTools: ["Brainstorming", "Open discussion"],
    outcomeHint: "e.g. Align on Q2 priorities and agree which two projects to pause",
  },
  kickoff: {
    label: "Project kick-off",
    desc: "Launch a project with shared understanding and commitment.",
    recommendedTools: ["Storyboarding", "RACI clarification"],
    outcomeHint: "e.g. Agree scope, roles and first milestone for the CRM migration",
  },
  problemsolving: {
    label: "Problem-solving",
    desc: "Move from a defined problem to a viable solution.",
    recommendedTools: ["Five Whys", "Six Thinking Hats", "Force Field Analysis"],
    outcomeHint: "e.g. Identify root cause of late deliveries and agree three corrective actions",
  },
};

// ─── Facilitation mode logic ──────────────────────────────────────────────────

function getFacilitationMode(meetingType, groupExperience) {
  if (groupExperience === "new" || meetingType === "kickoff") return {
    mode: "Directive", color: COLORS.red2, colorLight: "#FEF2F2",
    summary: "Lead the structure clearly. Set the agenda, manage the process, and make the meeting safe for people who do not yet know the norms.",
    tip: "Introduce the purpose and ground rules at the start. Do not assume people know why they are there.",
  };
  if (groupExperience === "experienced" && meetingType === "problemsolving") return {
    mode: "Delegative", color: COLORS.green, colorLight: COLORS.greenLight,
    summary: "The group has the expertise. Your role is to protect the process and intervene only when it breaks down.",
    tip: "Resist the urge to contribute to the content. Ask questions that push thinking rather than supplying answers.",
  };
  return {
    mode: "Collaborative", color: COLORS.blue, colorLight: COLORS.blueLight,
    summary: "Share the process with the group. You shape the structure, they own the content. This produces better decisions and stronger commitment.",
    tip: "Invite contributions explicitly. Do not let silence mean consent — check for genuine agreement before moving on.",
  };
}

// ─── Cadence logic ────────────────────────────────────────────────────────────

function getCadenceGuidance(meetingType, frequency) {
  if (meetingType === "team") {
    if (frequency === "weekly") return {
      recommendation: "Weekly is right for most teams — enough rhythm to maintain alignment without becoming overhead. Keep them short: 45–60 minutes maximum.",
      tip: "If your weekly meeting regularly runs over 60 minutes, the agenda needs redesigning. Move status updates async and use the time only for decisions and blockers.",
    };
    if (frequency === "fortnightly") return {
      recommendation: "Fortnightly works well for stable teams where day-to-day coordination happens informally. Supplement with a brief async update on the off weeks.",
      tip: "A fortnightly rhythm requires a more structured agenda — more ground to cover, less time to drift.",
    };
    return {
      recommendation: "Monthly team meetings work only when the team has strong informal communication. Use them for bigger-picture review rather than operational detail.",
      tip: "Monthly meetings need a clear structure or they become general conversation. Send a written update in advance so the time is spent on discussion, not briefing.",
    };
  }
  if (meetingType === "kickoff") return {
    recommendation: "A kick-off is a one-off event, but it should be followed by a weekly or fortnightly check-in for the first month of the project.",
    tip: "Schedule the first check-in before you leave the kick-off meeting. The gap between kick-off and first review is where momentum is most easily lost.",
  };
  return {
    recommendation: "Problem-solving meetings should be scheduled as needed, not on a recurring basis. Once the problem is resolved, close the cadence.",
    tip: "Set a clear deadline for the solution at the start of the process. Open-ended problem-solving meetings drift. A deadline creates productive urgency.",
  };
}

// ─── ICS download ─────────────────────────────────────────────────────────────

function generateICS({ meetingTitle, managerName, cadence, frequency }) {
  const freq = (frequency || "").toLowerCase();
  let rrule = "RRULE:FREQ=MONTHLY";
  if (freq === "weekly") rrule = "RRULE:FREQ=WEEKLY";
  else if (freq === "fortnightly") rrule = "RRULE:FREQ=WEEKLY;INTERVAL=2";
  const now = new Date(), start = new Date(now);
  start.setDate(now.getDate() + 7);
  const day = start.getDay();
  if (day === 0) start.setDate(start.getDate() + 1);
  if (day === 6) start.setDate(start.getDate() + 2);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60000);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//The Message Business//MeetingIgnite//EN",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",
    `UID:meetingignite-${Date.now()}@themessagebusiness.com`,
    `SUMMARY:${meetingTitle}`,
    `DTSTART:${fmt(start)}`,`DTEND:${fmt(end)}`,
    `DESCRIPTION:${(cadence?.recommendation || "").replace(/\n/g,"\\n")}`,
    `ORGANIZER;CN=${managerName}:mailto:organizer@meetingignite.app`,
    rrule,"STATUS:CONFIRMED","BEGIN:VALARM","TRIGGER:-PT15M","ACTION:DISPLAY",
    "DESCRIPTION:Reminder","END:VALARM","END:VEVENT","END:VCALENDAR"
  ].join("\r\n");
  const blob = new Blob([lines], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `meetingignite-${meetingTitle.replace(/\s+/g,"-").toLowerCase()}.ics`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Local storage ────────────────────────────────────────────────────────────

function getUsageCount() { try { return parseInt(localStorage.getItem("mi_usage") || "0"); } catch { return 0; } }
function incrementUsage() { try { localStorage.setItem("mi_usage", String(getUsageCount() + 1)); } catch {} }
function getSavedSessions() { try { return JSON.parse(localStorage.getItem("mi_saved") || "[]"); } catch { return []; } }
function saveLocalSession(data) {
  try {
    const s = getSavedSessions();
    s.unshift({ ...data, id: Date.now(), date: new Date().toLocaleDateString("en-GB") });
    localStorage.setItem("mi_saved", JSON.stringify(s.slice(0, 20)));
  } catch {}
}

const FREE_LIMIT = 3;

// ─── Components ───────────────────────────────────────────────────────────────

function Badge({ color, children }) {
  const styles = {
    blue: { bg: COLORS.sunk, text: COLORS.navyMid },
    teal: { bg: COLORS.tealLight, text: COLORS.navy },
    amber: { bg: COLORS.amberLight, text: COLORS.amber },
    green: { bg: COLORS.greenLight, text: COLORS.green },
  };
  const s = styles[color] || styles.blue;
  return <span style={{ background: s.bg, color: s.text, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999, letterSpacing: "0.01em", fontFamily: FONT.sans, whiteSpace: "nowrap" }}>{children}</span>;
}

function OutputBox({ title, content, badge, spoken }) {
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState(content);
  useEffect(() => { setText(content); }, [content]);
  const copy = () => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  const emailIt = () => {
    const s = encodeURIComponent(`Meeting Ignite: ${title}`), b = encodeURIComponent(text);
    const a = document.createElement("a"); a.href = `mailto:?subject=${s}&body=${b}`; a.target = "_blank";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };
  const shareIt = async () => {
    if (navigator.share) { try { await navigator.share({ title: `Meeting Ignite: ${title}`, text }); } catch { emailIt(); } }
    else { emailIt(); }
  };
  return (
    <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", background: COLORS.white }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.navy, fontFamily: FONT.sans }}>{title}</span>
          {badge && <Badge color={badge.color}>{badge.label}</Badge>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={copy} style={{ fontSize: 13, minHeight: 36, padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: 10, background: copied ? COLORS.greenLight : COLORS.white, color: copied ? COLORS.green : COLORS.navy, cursor: "pointer", fontWeight: 500, fontFamily: FONT.sans }}>{copied ? "Copied" : "Copy"}</button>
          <button onClick={shareIt} style={{ fontSize: 13, minHeight: 36, padding: "0 14px", border: `1px solid ${COLORS.border}`, borderRadius: 10, background: COLORS.white, color: COLORS.navy, cursor: "pointer", fontWeight: 500, fontFamily: FONT.sans }}>Share</button>
        </div>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} style={spoken
        ? { width: "100%", minHeight: 320, padding: "24px 28px", border: "none", outline: "none", resize: "vertical", fontSize: 19, lineHeight: "30px", color: COLORS.navy, fontFamily: FONT.spoken, fontVariationSettings: '"SOFT" 0, "WONK" 0', fontWeight: 400, boxSizing: "border-box", background: COLORS.white }
        : { width: "100%", minHeight: 280, padding: "20px 24px", border: "none", outline: "none", resize: "vertical", fontSize: 15, lineHeight: 1.65, color: COLORS.navyMid, fontFamily: FONT.sans, boxSizing: "border-box", background: COLORS.white }} />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, multiline, required, hint }) {
  const style = { width: "100%", minHeight: 44, padding: "10px 16px", border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 15, color: COLORS.text, background: COLORS.white, boxSizing: "border-box", fontFamily: FONT.sans };
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ ...{ display: "block", fontSize: 13, fontWeight: 600, letterSpacing: "0.01em", color: COLORS.muted, marginBottom: 8, fontFamily: FONT.sans }, marginBottom: hint ? 4 : 8 }}>
        {label}{required && <span style={{ color: COLORS.red2 }}> *</span>}
      </label>
      {hint && <p style={{ fontSize: 14, color: COLORS.navyMid, margin: "0 0 8px", fontFamily: FONT.sans, lineHeight: "20px" }}>{hint}</p>}
      {multiline
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} style={{ ...style, resize: "vertical" }} />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={style} />
      }
    </div>
  );
}

function ToggleGroup({ label, value, onChange, options, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ ...{ display: "block", fontSize: 13, fontWeight: 600, letterSpacing: "0.01em", color: COLORS.muted, marginBottom: 8, fontFamily: FONT.sans }, marginBottom: hint ? 4 : 8 }}>{label}</label>
      {hint && <p style={{ fontSize: 14, color: COLORS.navyMid, margin: "0 0 8px", fontFamily: FONT.sans, lineHeight: "20px" }}>{hint}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
            style={{ minHeight: 40, padding: "8px 18px", border: `1px solid ${value === o.value ? COLORS.navy : COLORS.border}`, boxShadow: value === o.value ? `inset 0 0 0 1px ${COLORS.navy}` : "none", borderRadius: 10, background: value === o.value ? COLORS.sunk : COLORS.white, color: COLORS.navy, fontSize: 14, fontWeight: value === o.value ? 600 : 400, cursor: "pointer", fontFamily: FONT.sans, textAlign: "left", transition: "all 0.15s" }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────

function AuthModal({ onClose }) {
  const [email, setEmail] = useState(""), [sent, setSent] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const send = async () => {
    if (!email.trim()) { setError("Please enter your email."); return; }
    setLoading(true); setError("");
    const { error: e } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    if (e) { setError(e.message); setLoading(false); return; }
    setSent(true); setLoading(false);
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(27,42,74,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div style={{ background: COLORS.white, borderRadius: 22, boxShadow: SHADOW, padding: "40px 36px", maxWidth: 420, width: "100%" }}>
        {!sent ? (<>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: COLORS.navy, margin: "0 0 8px", fontFamily: FONT.sans }}>Sign in to Meeting Ignite</h2>
            <p style={{ fontSize: 14, color: COLORS.muted, margin: 0, fontFamily: FONT.sans, lineHeight: 1.6 }}>Enter your email and we will send you a magic link. No password needed.</p>
          </div>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="your@email.com"
            style={{ width: "100%", minHeight: 44, padding: "10px 16px", border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 15, color: COLORS.text, boxSizing: "border-box", fontFamily: FONT.sans, marginBottom: 12 }} />
          {error && <p style={{ fontSize: 13, color: COLORS.red2, margin: "0 0 10px", fontFamily: FONT.sans }}>{error}</p>}
          <button onClick={send} disabled={loading} style={{ width: "100%", minHeight: 44, padding: "0 24px", background: COLORS.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: FONT.sans, marginBottom: 10 }}>
            {loading ? "Sending..." : "Send magic link"}
          </button>
          <button onClick={onClose} style={{ width: "100%", background: "none", border: "none", color: COLORS.muted, fontSize: 13, cursor: "pointer", padding: 4, fontFamily: FONT.sans }}>Cancel</button>
        </>) : (
          <div style={{ textAlign: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: COLORS.navy, margin: "0 0 10px", fontFamily: FONT.sans }}>Check your email</h2>
            <p style={{ fontSize: 14, color: COLORS.muted, lineHeight: 1.6, margin: "0 0 20px", fontFamily: FONT.sans }}>We sent a magic link to <strong>{email}</strong>.</p>
            <button onClick={onClose} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 13, cursor: "pointer", fontFamily: FONT.sans }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Upgrade Modal ────────────────────────────────────────────────────────────

function UpgradeModal({ onClose, triggered }) {
  const [loadingPlan, setLoadingPlan] = useState(null), [checkoutError, setCheckoutError] = useState("");
  const plans = [
    { id: "monthly", name: "Monthly", price: "£4.99", period: "/month", desc: "Full access, cancel anytime.", highlight: false },
    { id: "annual", name: "Annual", price: "£59.99", period: "/year", desc: "Best value: two months free.", highlight: true },
    { id: "lifetime", name: "Lifetime", price: "£49.99", period: "one-off", desc: "Pay once, use forever.", highlight: false },
  ];
  const handleCheckout = async (planId) => {
    setLoadingPlan(planId); setCheckoutError("");
    try {
      const r = await fetch("/api/stripe-checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: planId, origin: window.location.origin }) });
      const d = await r.json();
      if (d.url) { window.location.href = d.url; } else { setCheckoutError("Something went wrong."); setLoadingPlan(null); }
    } catch { setCheckoutError("Something went wrong."); setLoadingPlan(null); }
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(27,42,74,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
      <div style={{ background: COLORS.white, borderRadius: 22, boxShadow: SHADOW, padding: "40px 36px", maxWidth: 520, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: COLORS.navy, margin: "0 0 8px", fontFamily: FONT.sans }}>
            {triggered === "limit" ? "You have used your 3 free meetings" : triggered === "pdf" ? "Download this as a branded PDF" : "Meeting Ignite Pro"}
          </h2>
          <p style={{ fontSize: 14, color: COLORS.muted, margin: 0, lineHeight: 1.6, fontFamily: FONT.sans }}>{triggered === "pdf" ? "Pro lets you download the whole meeting, agenda, facilitation guide, and after the meeting the actions summary, follow-up note and process review, as a branded PDF." : "Unlimited meeting guides, agenda builder, facilitation notes, actions summaries, and follow-up notes."}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {plans.map(plan => (
            <div key={plan.id} style={{ border: `1px solid ${plan.highlight ? COLORS.navy : COLORS.border}`, boxShadow: plan.highlight ? `inset 0 0 0 1px ${COLORS.navy}` : "none", borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", background: COLORS.white, gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.navy, fontFamily: FONT.sans }}>{plan.name}</span>
                  {plan.highlight && <Badge color="teal">Most popular</Badge>}
                </div>
                <p style={{ fontSize: 12.5, color: COLORS.muted, margin: 0, fontFamily: FONT.sans }}>{plan.desc}</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: COLORS.navy, fontFamily: FONT.sans }}>{plan.price}</span>
                  <span style={{ fontSize: 12, color: COLORS.muted, fontFamily: FONT.sans }}> {plan.period}</span>
                </div>
                <button onClick={() => handleCheckout(plan.id)} disabled={!!loadingPlan}
                  style={{ minHeight: 40, padding: "0 18px", background: plan.highlight ? COLORS.navy : COLORS.white, color: plan.highlight ? "#fff" : COLORS.navy, border: `1px solid ${plan.highlight ? COLORS.navy : COLORS.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: loadingPlan ? "not-allowed" : "pointer", fontFamily: FONT.sans, opacity: loadingPlan && loadingPlan !== plan.id ? 0.5 : 1, minWidth: 80 }}>
                  {loadingPlan === plan.id ? "..." : "Select"}
                </button>
              </div>
            </div>
          ))}
        </div>
        {checkoutError && <p style={{ fontSize: 13, color: COLORS.red2, textAlign: "center", margin: "0 0 12px", fontFamily: FONT.sans }}>{checkoutError}</p>}
        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <p style={{ fontSize: 12, color: COLORS.muted, margin: 0, fontFamily: FONT.sans }}>Secure payment by Stripe. Cancel anytime.</p>
          <button onClick={onClose} style={{ background: "none", border: "none", color: COLORS.muted, fontSize: 13, cursor: "pointer", padding: 4, fontFamily: FONT.sans }}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────

function HistoryPanel({ items, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(27,42,74,0.45)", display: "flex", justifyContent: "flex-end", zIndex: 1000 }}>
      <div style={{ background: COLORS.white, width: "100%", maxWidth: 460, height: "100vh", overflowY: "auto", padding: "28px 24px", fontFamily: FONT.sans }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: COLORS.navy, margin: 0 }}>Meeting history</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 24, minWidth: 44, minHeight: 44, cursor: "pointer", color: COLORS.navy, fontFamily: FONT.sans }}>×</button>
        </div>
        {items.length === 0
          ? <p style={{ color: COLORS.muted, fontSize: 14 }}>No saved meetings yet.</p>
          : items.map(item => (
            <div key={item.id} style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.navy }}>{item.meetingTitle || "Untitled meeting"}</span>
                <span style={{ fontSize: 12, color: COLORS.muted }}>{item.date || ""}</span>
              </div>
              <p style={{ fontSize: 13, color: COLORS.muted, margin: "0 0 6px" }}>{item.managerName}</p>
              {item.meetingType && <Badge color="blue">{MEETING_TYPES[item.meetingType]?.label || item.meetingType}</Badge>}
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function MeetingIgnite() {
  // Stage: "prepare" or "close"
  const [stage, setStage] = useState("prepare");

  // Prepare form
  const [prepForm, setPrepForm] = useState({
    managerName: "", meetingTitle: "", meetingType: "",
    desiredOutcome: "", attendees: "", duration: "",
    groupExperience: "", frequency: "", saveLocally: false,
  });

  // Close form (actions captured after the meeting)
  const [closeForm, setCloseForm] = useState({
    actionsNotes: "", decisionsNotes: "", anythingUnresolved: "",
  });

  const [prepResult, setPrepResult] = useState(null);
  const [closeResult, setCloseResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeTrigger, setUpgradeTrigger] = useState("manual");
  const [showHistory, setShowHistory] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [usageCount, setUsageCount] = useState(getUsageCount());
  const [history, setHistory] = useState(getSavedSessions());
  const [isPro, setIsPro] = useState(() => { try { return localStorage.getItem("mi_pro") === "true"; } catch { return false; } });
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [user, setUser] = useState(null);
  const [outcomeCheck, setOutcomeCheck] = useState(null);
  const [sharpenedOutcome, setSharpenedOutcome] = useState("");
  const [outcomeAccepted, setOutcomeAccepted] = useState(false);
  const [facilitationMode, setFacilitationMode] = useState(null);
  const [cadence, setCadence] = useState(null);
  const resultsRef = useRef(null);
  const closeResultsRef = useRef(null);
  const pf = (k) => (v) => setPrepForm(p => ({ ...p, [k]: v }));
  const cf = (k) => (v) => setCloseForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { if (session?.user) setUser(session.user); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (session?.user) setUser(session.user); else setUser(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("session_id")) {
      try { localStorage.setItem("mi_pro", "true"); } catch {}
      setIsPro(true); setShowSuccessBanner(true);
      window.history.replaceState({}, "", "/");
      setTimeout(() => setShowSuccessBanner(false), 6000);
    }
    if (params.get("cancelled")) window.history.replaceState({}, "", "/");
  }, []);

  useEffect(() => {
    if (prepForm.meetingType && prepForm.groupExperience) {
      setFacilitationMode(getFacilitationMode(prepForm.meetingType, prepForm.groupExperience));
    } else setFacilitationMode(null);
    if (prepForm.meetingType && prepForm.frequency) {
      setCadence(getCadenceGuidance(prepForm.meetingType, prepForm.frequency));
    } else setCadence(null);
  }, [prepForm.meetingType, prepForm.groupExperience, prepForm.frequency]);

  const validatePrep = () => {
    if (!prepForm.managerName.trim()) return "Your name is required.";
    if (!prepForm.meetingTitle.trim()) return "Meeting title is required.";
    if (!prepForm.meetingType) return "Please select a meeting type.";
    if (!prepForm.desiredOutcome.trim()) return "Desired outcome is required.";
    if (!prepForm.groupExperience) return "Please select the group's experience level.";
    return null;
  };

  const validateClose = () => {
    if (!closeForm.actionsNotes.trim()) return "Please enter the actions agreed in the meeting.";
    return null;
  };

  const buildOutcomeCheckPrompt = () =>
    `You are reviewing a manager's meeting outcome before they generate a meeting guide.

MEETING TYPE: ${MEETING_TYPES[prepForm.meetingType]?.label || prepForm.meetingType}
DESIRED OUTCOME: ${prepForm.desiredOutcome}

Decide whether the outcome is specific enough to run a productive meeting.

A good meeting outcome describes what will be DECIDED, AGREED or PRODUCED — not just what will be discussed. "Discuss the project" is a topic, not an outcome. "Agree the three priorities for Q3 and assign owners" is an outcome.

Respond in EXACTLY this format:
STATUS: [PASS or FAIL]
REASON: [One plain sentence.]
SHARPENED: [If FAIL, rewrite as a specific outcome, one sentence at most. If PASS, repeat original unchanged. Write nothing after it.]`;

  const buildPrepPrompt = (outcome) => {
    const mt = MEETING_TYPES[prepForm.meetingType];
    const fm = getFacilitationMode(prepForm.meetingType, prepForm.groupExperience);
    const cad = getCadenceGuidance(prepForm.meetingType, prepForm.frequency);
    return `You are an expert meeting facilitator helping a manager prepare for a meeting. Generate a practical, structured meeting guide.

INPUTS:
- Manager: ${prepForm.managerName}
- Meeting title: ${prepForm.meetingTitle}
- Meeting type: ${mt?.label}
- Desired outcome: ${outcome}
- Attendees: ${prepForm.attendees || "Not specified"}
- Duration: ${prepForm.duration || "Not specified"}
- Group experience: ${prepForm.groupExperience}
- Facilitation mode: ${fm.mode}
- Facilitation tip: ${fm.tip}

MEETING TYPE CONTEXT:
- Recommended tools: ${mt?.recommendedTools?.join(", ")}
- Mode summary: ${fm.summary}

CADENCE: ${cad?.recommendation || ""}

FIXED FACILITATION PRINCIPLES (always include):
1. Send the agenda in advance — never brief people cold on the day.
2. State the desired outcome at the start of the meeting, not just the topics.
3. Draw out quieter voices deliberately — do not let the loudest person fill the room.
4. Close with explicit actions: who will do what by when.

OUTPUT RULES (apply to every section below, without exception):
- Plain text only. No markdown of any kind. No asterisks for bold or emphasis, no ## or ### headings, no hyphen, asterisk, or bullet lists, no backticks, and no hashtags or tags of any kind anywhere (never end with something like "#management"). Where you need structure, use plain labels followed by a colon, or a simple numbered list written inline as "1. ... 2. ...".
- No exclamation marks anywhere.
- No rallying-cry or cheerleading. Close on something concrete and useful, not encouragement.
- UK English throughout. Plain, direct. Active voice.
- In sentences, do not use em dashes: use a comma, a colon, or a full stop instead. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", or the phrase "moving forward".

YOUR RESPONSE MUST USE EXACTLY THIS FORMAT:

FACILITATOR_NOTE: [One sentence — the single most important thing for ${prepForm.managerName} to hold in mind running this meeting.]

AGENDA: [A structured, timed agenda for this meeting. Include: opening (state outcome and ground rules), each agenda item with suggested time allocation, and a close (actions review and next steps). Format each item clearly. Tailor to the meeting type and outcome. Minimum 300 words.]

FACILITATION_GUIDE: [Practical coaching notes for ${prepForm.managerName}. Cover: how to open well, how to manage discussion for this type of meeting, which facilitation technique(s) to use and why, how to draw out quieter voices, how to handle disagreement or dominant voices, and how to close with genuine clarity. Include the fixed principles above. Minimum 350 words.]`;
  };

  const buildClosePrompt = () =>
    `You are helping a manager close out a meeting and create a follow-up summary.

MEETING CONTEXT:
- Meeting title: ${prepResult?.meetingTitle || prepForm.meetingTitle}
- Meeting type: ${MEETING_TYPES[prepForm.meetingType]?.label}
- Manager: ${prepForm.managerName}
- Original desired outcome: ${prepResult?.outcome || prepForm.desiredOutcome}

WHAT THE MANAGER CAPTURED DURING THE MEETING:
- Actions agreed: ${closeForm.actionsNotes}
- Decisions made: ${closeForm.decisionsNotes || "Not recorded separately"}
- Anything unresolved: ${closeForm.anythingUnresolved || "Nothing noted"}

OUTPUT RULES (apply to every section below, without exception):
- Plain text only. No markdown of any kind. No asterisks, no ## headings, no bullet lists, no backticks, and no hashtags or tags anywhere (never end with something like "#management").
- No exclamation marks. No cheerleading.
- UK English throughout. Plain, direct, professional. Active voice.
- In sentences, do not use em dashes: use a comma, a colon, or a full stop instead. The dash separators in the actions summary format below are the one exception and should be kept. Do not use the words "leverage", "empower", "unlock", "journey", "delve", "robust", "seamless", "inspire", or the phrase "moving forward".

YOUR RESPONSE MUST USE EXACTLY THIS FORMAT:

ACTIONS_SUMMARY: [A clean actions summary ready to send to all attendees. Write each action on its own line in the form: Action — Owner — By when (a plain dash between the three parts is fine; this is not markdown). Use the manager's notes as the basis. For the "by when": if the manager's note gives a date or a relative time (for example "by Friday", "next week", "before the next meeting"), use it exactly as written. If no timing is given for an action, write [by when] as a plain blank for the manager to fill in. Never invent or guess a specific calendar date — do not write an absolute date that was not in the manager's notes. Begin with a brief intro line confirming the meeting outcome. Professional, clear, ready to send. Minimum 150 words.]

FOLLOWUP_NOTE: [A brief follow-up note written by ${prepForm.managerName} and addressed to the whole group who attended, never to one named individual. Do not give the note a meeting label or title such as "Coaching Meeting 1" — it is simply a note to the group after the meeting. Warm, direct, professional. It summarises what the meeting achieved, confirms the actions list is attached, and states the next meeting date if one is known. If the next date is not known, write [next meeting date] as a plain blank for the manager to fill in — do not invent a date. Minimum 100 words.]

PROCESS_REVIEW: [Brief coaching notes for ${prepForm.managerName} — private, not for sharing. Three short observations: one thing that likely went well based on the context, one thing to watch for next time given this meeting type and group, and one specific improvement to try. Honest and practical. Minimum 80 words.]`;

  const generatePrep = async () => {
    const err = validatePrep();
    if (err) { setError(err); return; }
    if (!isPro && usageCount >= FREE_LIMIT) { setUpgradeTrigger("limit"); setShowUpgrade(true); return; }
    setError("");
    if (!outcomeAccepted) {
      setLoading(true); setOutcomeCheck(null);
      try {
        const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: buildOutcomeCheckPrompt() }] }) });
        const d = await r.json();
        const text = d.choices?.[0]?.message?.content || "";
        const status = (text.match(/STATUS:\s*(PASS|FAIL)/i)?.[1] || "PASS").toUpperCase();
        const reason = text.match(/REASON:\s*(.+)/i)?.[1]?.trim() || "";
        const sharpened = parseSharpened(text, prepForm.desiredOutcome, 250);
        if (status === "PASS") { setSharpenedOutcome(prepForm.desiredOutcome); setOutcomeAccepted(true); await runPrepGenerate(prepForm.desiredOutcome); }
        else { setOutcomeCheck({ reason, sharpened }); setSharpenedOutcome(sharpened); setLoading(false); }
      } catch { setError("Something went wrong. Please try again."); setLoading(false); }
      return;
    }
    await runPrepGenerate(sharpenedOutcome || prepForm.desiredOutcome);
  };

  const runPrepGenerate = async (outcome) => {
    setLoading(true); setPrepResult(null);
    try {
      const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: buildPrepPrompt(outcome) }] }) });
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content || "";
      const noteMatch = text.match(/FACILITATOR_NOTE:\s*([\s\S]+?)(?=AGENDA:|$)/i);
      const agendaMatch = text.match(/AGENDA:\s*([\s\S]+?)(?=FACILITATION_GUIDE:|$)/i);
      const guideMatch = text.match(/FACILITATION_GUIDE:\s*([\s\S]+)/i);
      const parsed = {
        facilitatorNote: noteMatch?.[1]?.trim() || "",
        agenda: agendaMatch?.[1]?.trim() || text,
        guide: guideMatch?.[1]?.trim() || "",
        meetingTitle: prepForm.meetingTitle,
        managerName: prepForm.managerName,
        meetingType: prepForm.meetingType,
        outcome,
        facilitationMode: getFacilitationMode(prepForm.meetingType, prepForm.groupExperience),
        cadence: getCadenceGuidance(prepForm.meetingType, prepForm.frequency),
      };
      setPrepResult(parsed);
      if (!isPro) { incrementUsage(); setUsageCount(getUsageCount()); }
      if (prepForm.saveLocally) { saveLocalSession({ meetingTitle: prepForm.meetingTitle, managerName: prepForm.managerName, meetingType: prepForm.meetingType }); setHistory(getSavedSessions()); }
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const generateClose = async () => {
    const err = validateClose();
    if (err) { setError(err); return; }
    setLoading(true); setCloseResult(null); setError("");
    try {
      const r = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: buildClosePrompt() }] }) });
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content || "";
      const actionsMatch = text.match(/ACTIONS_SUMMARY:\s*([\s\S]+?)(?=FOLLOWUP_NOTE:|$)/i);
      const followupMatch = text.match(/FOLLOWUP_NOTE:\s*([\s\S]+?)(?=PROCESS_REVIEW:|$)/i);
      const reviewMatch = text.match(/PROCESS_REVIEW:\s*([\s\S]+)/i);
      setCloseResult({
        actions: actionsMatch?.[1]?.trim() || text,
        followup: followupMatch?.[1]?.trim() || "",
        review: reviewMatch?.[1]?.trim() || "",
      });
      setTimeout(() => closeResultsRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setLoading(false); }
  };

  const resetAll = () => {
    setOutcomeCheck(null); setSharpenedOutcome(""); setOutcomeAccepted(false);
    setPrepResult(null); setCloseResult(null); setStage("prepare");
    setCloseForm({ actionsNotes: "", decisionsNotes: "", anythingUnresolved: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const downloadPdf = async () => {
    if (!prepResult) return;
    if (!isPro) { setUpgradeTrigger("pdf"); setShowUpgrade(true); return; }
    setDownloadingPdf(true);
    try {
      const res = await fetch("/api/generate-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "meeting", prepForm, prepResult, closeResult }) });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pdfName("Meeting Ignite", prepResult.meetingTitle);
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError("The PDF could not be generated. Please try again.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut(); setUser(null); setIsPro(false);
    try { localStorage.removeItem("mi_pro"); } catch {}
  };

  const remaining = isPro ? null : Math.max(0, FREE_LIMIT - usageCount);

  return (
    <div style={{ fontFamily: FONT.sans, background: COLORS.canvas, color: COLORS.text, minHeight: "100vh" }}>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} triggered={upgradeTrigger} />}
      {showHistory && <HistoryPanel items={history} onClose={() => setShowHistory(false)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showSuccessBanner && (
        <div style={{ background: COLORS.tealLight, padding: "12px 24px", textAlign: "center" }}>
          <span style={{ color: COLORS.navy, fontSize: 14, fontWeight: 600, fontFamily: FONT.sans }}>Payment successful. You now have unlimited access to Meeting Ignite Pro.</span>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ height: 3, background: COLORS.tool }} />
      <div style={{ background: COLORS.canvas, borderBottom: `1px solid ${COLORS.border}`, padding: "0 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 68, gap: 12, flexWrap: "wrap", padding: "10px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/mi-mark.svg" alt="" width="26" height="26" style={{ display: "block" }} />
            <span style={{ fontSize: 18, fontWeight: 600, color: COLORS.navy, letterSpacing: "-0.02em" }}>Meeting Ignite</span>
            <Badge color={isPro ? "green" : "blue"}>{isPro ? "Pro" : "Beta"}</Badge>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <a href={DASHBOARD_URL} style={{ background: "none", border: "none", color: COLORS.navyMid, fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "8px 6px", fontFamily: FONT.sans, textDecoration: "none" }}>Back to dashboard</a>
            <button onClick={() => setShowHistory(true)} style={{ background: "none", border: "none", color: COLORS.navyMid, fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "8px 6px", fontFamily: FONT.sans }}>History</button>
            {user ? (
              <>
                <span style={{ fontSize: 13, color: COLORS.muted, fontFamily: FONT.sans }}>{user.email}</span>
                <button onClick={signOut} style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, minHeight: 36, padding: "0 14px", fontSize: 14, color: COLORS.navy, fontFamily: FONT.sans, cursor: "pointer" }}>Sign out</button>
              </>
            ) : (
              <button onClick={() => setShowAuth(true)} style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, minHeight: 36, padding: "0 14px", fontSize: 14, color: COLORS.navy, fontFamily: FONT.sans, cursor: "pointer" }}>Sign in</button>
            )}
            {!isPro && (
              <>
                <span style={{ background: COLORS.sunk, borderRadius: 999, padding: "4px 12px", fontSize: 13, color: COLORS.navyMid, fontFamily: FONT.sans }}>{remaining} free {remaining === 1 ? "use" : "uses"} left</span>
                <button onClick={() => { setUpgradeTrigger("manual"); setShowUpgrade(true); }} style={{ background: COLORS.navy, border: "none", borderRadius: 10, minHeight: 36, padding: "0 16px", fontSize: 14, color: "#fff", fontFamily: FONT.sans, fontWeight: 600, cursor: "pointer" }}>Upgrade</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Hero ── */}
      <div style={{ background: COLORS.canvas }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px 8px" }}>
          <h1 style={{ fontSize: "clamp(32px, 6vw, 40px)", fontWeight: 600, color: COLORS.navy, margin: "0 0 12px", lineHeight: 1.1, letterSpacing: "-0.03em" }}>
            Run meetings that end<br/>with something real.
          </h1>
          <p style={{ fontSize: 18, lineHeight: "28px", color: COLORS.navyMid, margin: 0, maxWidth: "40rem", fontFamily: FONT.sans }}>
            Prepare before. Close properly after. Every meeting ends with a clear agenda, a facilitation guide, and an actions summary ready to send.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: "0 auto", padding: "28px 24px 60px" }}>

        {/* ── Stage switcher ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 24 }}>
          {[
            { key: "prepare", n: "1", label: "Prepare", desc: "Before the meeting" },
            { key: "close", n: "2", label: "Close", desc: "After the meeting" },
          ].map(s => (
            <button key={s.key} onClick={() => setStage(s.key)} aria-pressed={stage === s.key}
              style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 64, padding: "12px 20px", border: `1px solid ${stage === s.key ? COLORS.navy : COLORS.border}`, boxShadow: stage === s.key ? `inset 0 0 0 1px ${COLORS.navy}` : "none", borderRadius: 10, background: stage === s.key ? COLORS.sunk : COLORS.white, cursor: "pointer", textAlign: "left", fontFamily: FONT.sans, transition: "all 0.15s" }}>
              <span style={{ fontSize: 20, fontWeight: 600, color: COLORS.teal, lineHeight: 1 }}>{s.n}</span>
              <span>
                <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: COLORS.navy, marginBottom: 2 }}>{s.label}</span>
                <span style={{ display: "block", fontSize: 13, color: COLORS.navyMid }}>{s.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {/* ── PREPARE STAGE ── */}
        {stage === "prepare" && (
          <>
            <div style={{ background: COLORS.white, borderRadius: 22, boxShadow: SHADOW, padding: "clamp(24px, 5vw, 48px)", marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.navy, margin: "0 0 24px", fontFamily: FONT.sans }}>
                About this meeting
              </h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 20px" }}>
                <TextField label="Your name" value={prepForm.managerName} onChange={pf("managerName")} placeholder="Your name" required />
                <TextField label="Meeting title" value={prepForm.meetingTitle} onChange={pf("meetingTitle")} placeholder="e.g. Q3 planning, design team" required />
              </div>

              {/* Meeting type selector */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, letterSpacing: "0.01em", color: COLORS.muted, marginBottom: 8, fontFamily: FONT.sans }}>Meeting type <span style={{ color: COLORS.red2 }}>*</span></label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                  {Object.entries(MEETING_TYPES).map(([key, mt]) => (
                    <button key={key} onClick={() => pf("meetingType")(key)} aria-pressed={prepForm.meetingType === key}
                      style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", padding: "14px 16px", border: `1px solid ${prepForm.meetingType === key ? COLORS.navy : COLORS.border}`, boxShadow: prepForm.meetingType === key ? `inset 0 0 0 1px ${COLORS.navy}` : "none", borderRadius: 10, background: prepForm.meetingType === key ? COLORS.sunk : COLORS.white, cursor: "pointer", textAlign: "left", fontFamily: FONT.sans, transition: "all 0.15s" }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.navy, fontFamily: FONT.sans, marginBottom: 4 }}>{mt.label}</div>
                      <div style={{ fontSize: 13, color: COLORS.navyMid, fontFamily: FONT.sans, lineHeight: "18px" }}>{mt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <TextField
                label="Desired outcome"
                value={prepForm.desiredOutcome}
                onChange={pf("desiredOutcome")}
                placeholder={prepForm.meetingType ? MEETING_TYPES[prepForm.meetingType]?.outcomeHint : "What will be decided, agreed or produced by the end of this meeting?"}
                hint="Describe what will be decided or agreed, not just what will be discussed."
                required multiline
              />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 20px" }}>
                <TextField label="Who will be there" value={prepForm.attendees} onChange={pf("attendees")} placeholder="e.g. Sarah (PM), Tom, Priya, whole design team" />
                <TextField label="Duration" value={prepForm.duration} onChange={pf("duration")} placeholder="e.g. 60 minutes" />
              </div>

              <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 20, marginTop: 4 }}>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: COLORS.navy, margin: "0 0 16px", fontFamily: FONT.sans }}>About the group</h3>
                <ToggleGroup
                  label="Group's experience working together"
                  value={prepForm.groupExperience}
                  onChange={pf("groupExperience")}
                  options={[
                    { value: "new", label: "New: first time or rarely meet" },
                    { value: "developing", label: "Developing: meet regularly, still finding rhythm" },
                    { value: "experienced", label: "Experienced: established team, high trust" },
                  ]}
                />
                <ToggleGroup
                  label="Meeting frequency (for cadence advice)"
                  value={prepForm.frequency}
                  onChange={pf("frequency")}
                  options={[
                    { value: "one-off", label: "One-off" },
                    { value: "weekly", label: "Weekly" },
                    { value: "fortnightly", label: "Fortnightly" },
                    { value: "monthly", label: "Monthly" },
                  ]}
                />
              </div>

              {/* Facilitation mode preview */}
              {facilitationMode && (
                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 20, marginTop: 4 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 600, color: COLORS.navy, margin: "0 0 12px", fontFamily: FONT.sans }}>Recommended facilitation mode</h3>
                  <div style={{ background: COLORS.tealLight, borderRadius: 10, padding: "16px 20px" }}>
                    <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.navy, margin: "0 0 4px", fontFamily: FONT.sans }}>{facilitationMode.mode}</p>
                    <p style={{ fontSize: 14, color: COLORS.text, margin: "0 0 6px", fontFamily: FONT.sans, lineHeight: "20px" }}>{facilitationMode.summary}</p>
                    <p style={{ fontSize: 13, color: COLORS.navyMid, margin: 0, fontFamily: FONT.sans, lineHeight: 1.5 }}>{facilitationMode.tip}</p>
                  </div>
                </div>
              )}

              {/* Cadence preview */}
              {cadence && (
                <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 20, marginTop: 4 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 600, color: COLORS.navy, margin: "0 0 12px", fontFamily: FONT.sans }}>Cadence guidance</h3>
                  <div style={{ background: COLORS.tealLight, borderRadius: 10, padding: "16px 20px" }}>
                    <p style={{ fontSize: 14, color: COLORS.text, margin: "0 0 6px", fontFamily: FONT.sans, lineHeight: "20px" }}>{cadence.recommendation}</p>
                    <p style={{ fontSize: 13, color: COLORS.navyMid, margin: 0, fontFamily: FONT.sans, lineHeight: 1.5 }}>{cadence.tip}</p>
                  </div>
                </div>
              )}

              <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16, marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: COLORS.navyMid, fontFamily: FONT.sans }}>
                  <input type="checkbox" checked={prepForm.saveLocally} onChange={e => setPrepForm(p => ({ ...p, saveLocally: e.target.checked }))} style={{ width: 18, height: 18, accentColor: COLORS.navy }} />
                  Save this meeting to history
                </label>
                {error && <p style={{ fontSize: 13, color: COLORS.red2, margin: 0, fontFamily: FONT.sans }}>{error}</p>}
              </div>

              <button onClick={generatePrep} disabled={loading}
                style={{ width: "100%", marginTop: 20, minHeight: 52, padding: "0 24px", background: COLORS.navy, opacity: loading ? 0.7 : 1, color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: FONT.sans, transition: "opacity 0.2s" }}>
                {loading ? "Building your meeting guide..." : "Generate meeting guide"}
              </button>

              {!isPro && remaining <= 1 && !loading && (
                <p style={{ textAlign: "center", fontSize: 12, color: COLORS.amber, marginTop: 10, fontFamily: FONT.sans }}>
                  {remaining === 0 ? "You've used all free meetings." : "Last free meeting."}{" "}
                  <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={() => { setUpgradeTrigger("limit"); setShowUpgrade(true); }}>Upgrade for unlimited access.</span>
                </p>
              )}
            </div>

            {/* Outcome sharpening */}
            {outcomeCheck && !outcomeAccepted && (
              <div style={{ background: COLORS.amberLight, borderRadius: 10, padding: "24px 28px", marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: COLORS.navy, margin: "0 0 4px", fontFamily: FONT.sans }}>Your meeting outcome needs sharpening</p>
                    <p style={{ fontSize: 13, color: COLORS.text, margin: 0, fontFamily: FONT.sans, lineHeight: 1.6 }}>{outcomeCheck.reason}</p>
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.navy, marginBottom: 8, fontFamily: FONT.sans }}>Suggested rewrite. Edit it if you need to.</label>
                  <textarea value={sharpenedOutcome} onChange={e => setSharpenedOutcome(e.target.value)} rows={3}
                    style={{ width: "100%", padding: "12px 16px", border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 15, lineHeight: 1.6, color: COLORS.text, fontFamily: FONT.sans, boxSizing: "border-box", background: COLORS.white, resize: "vertical" }} />
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={() => { setOutcomeAccepted(true); runPrepGenerate(sharpenedOutcome); }}
                    style={{ minHeight: 44, padding: "0 24px", background: COLORS.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT.sans }}>
                    Use this and generate the guide
                  </button>
                  <button onClick={() => { setOutcomeCheck(null); setOutcomeAccepted(true); setSharpenedOutcome(prepForm.desiredOutcome); runPrepGenerate(prepForm.desiredOutcome); }}
                    style={{ minHeight: 44, padding: "0 24px", background: COLORS.white, color: COLORS.navy, border: `1px solid ${COLORS.border}`, borderRadius: 10, fontSize: 15, fontWeight: 500, cursor: "pointer", fontFamily: FONT.sans }}>
                    Keep my original wording
                  </button>
                </div>
              </div>
            )}

            {/* Prep results */}
            {prepResult && (
              <div ref={resultsRef}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: COLORS.navy, margin: 0, fontFamily: FONT.sans }}>Your meeting guide</h2>
                  <Badge color="green">Ready to use</Badge>
                </div>

                {/* Facilitator note */}
                {prepResult.facilitatorNote && (
                  <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "20px 24px", marginBottom: 20 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.muted, letterSpacing: "0.01em", margin: "0 0 6px", fontFamily: FONT.sans }}>The most important thing to hold in mind</p>
                    <p style={{ fontSize: 18, fontWeight: 500, color: COLORS.navy, margin: 0, fontFamily: FONT.sans, lineHeight: "27px", letterSpacing: "-0.01em" }}>{prepResult.facilitatorNote}</p>
                  </div>
                )}

                {/* Mode + cadence row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 20 }}>
                  <div style={{ background: COLORS.tealLight, borderRadius: 10, padding: "20px 24px" }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.navy, letterSpacing: "0.01em", margin: "0 0 2px", fontFamily: FONT.sans }}>Facilitation mode</p>
                    <p style={{ fontSize: 16, fontWeight: 700, color: COLORS.navy, margin: "0 0 6px", fontFamily: FONT.sans }}>{prepResult.facilitationMode.mode}</p>
                    <p style={{ fontSize: 13, color: COLORS.navyMid, margin: 0, fontFamily: FONT.sans, lineHeight: 1.6 }}>{prepResult.facilitationMode.summary}</p>
                  </div>
                  {prepResult.cadence && (
                    <div style={{ background: COLORS.tealLight, borderRadius: 10, padding: "20px 24px" }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.navy, letterSpacing: "0.01em", margin: "0 0 6px", fontFamily: FONT.sans }}>Cadence guidance</p>
                      <p style={{ fontSize: 13, color: COLORS.text, margin: "0 0 6px", fontFamily: FONT.sans, lineHeight: 1.6 }}>{prepResult.cadence.recommendation}</p>
                      {prepForm.frequency && prepForm.frequency !== "one-off" && (
                        <button onClick={() => generateICS({ meetingTitle: prepResult.meetingTitle, managerName: prepResult.managerName, cadence: prepResult.cadence, frequency: prepForm.frequency })}
                          style={{ display: "flex", alignItems: "center", minHeight: 40, padding: "0 18px", background: COLORS.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: FONT.sans, marginTop: 12, whiteSpace: "nowrap" }}>
                          Add to calendar
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <OutputBox title="Meeting agenda" content={prepResult.agenda} badge={{ color: "teal", label: "Share in advance" }} spoken />
                <OutputBox title="Facilitation guide" content={prepResult.guide} badge={{ color: "blue", label: "Manager only" }} />

                {/* Prompt to move to close stage */}
                <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "20px 24px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
                  <div style={{ flex: "1 1 280px" }}>
                    <p style={{ fontSize: 16, fontWeight: 600, color: COLORS.navy, margin: "0 0 4px", fontFamily: FONT.sans }}>After the meeting</p>
                    <p style={{ fontSize: 14, color: COLORS.navyMid, margin: 0, fontFamily: FONT.sans, lineHeight: "20px" }}>Come back to the Close stage to generate your actions summary and follow-up note.</p>
                  </div>
                  <button onClick={() => setStage("close")}
                    style={{ minHeight: 44, padding: "0 24px", background: COLORS.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: FONT.sans, whiteSpace: "nowrap" }}>
                    Close the meeting →
                  </button>
                </div>

                <div style={{ background: COLORS.white, borderRadius: 10, padding: "16px 20px", border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <p style={{ fontSize: 14, color: COLORS.navyMid, margin: 0, fontFamily: FONT.sans }}>Both outputs are editable. Adjust to fit your voice before sharing.</p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={downloadPdf} disabled={downloadingPdf} style={{ fontSize: 14, minHeight: 44, padding: "0 20px", background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.navy, cursor: downloadingPdf ? "default" : "pointer", fontFamily: FONT.sans, fontWeight: 600, opacity: downloadingPdf ? 0.7 : 1 }}>{downloadingPdf ? "Preparing PDF..." : (isPro ? "Download PDF" : "Download PDF (Pro)")}</button>
                    <a href={DASHBOARD_URL} style={{ fontSize: 14, minHeight: 44, padding: "0 20px", background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.navy, cursor: "pointer", fontFamily: FONT.sans, fontWeight: 600, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Back to dashboard</a>
                    <button onClick={resetAll} style={{ fontSize: 14, minHeight: 44, padding: "0 20px", background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.navy, cursor: "pointer", fontFamily: FONT.sans, fontWeight: 500 }}>New meeting</button>
                  </div>
                </div>
              </div>
            )}

            {/* How it works */}
            {!prepResult && !loading && (
              <div style={{ marginTop: 8 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: COLORS.muted, letterSpacing: "0.01em", margin: "0 0 16px", fontFamily: FONT.sans }}>How it works</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                  {[
                    { n: "1", title: "Prepare", desc: "Set the outcome, meeting type and group profile. Get a timed agenda and facilitation guide." },
                    { n: "2", title: "Run", desc: "Use the facilitation guide in the room. Draw out all voices. Close with explicit actions." },
                    { n: "3", title: "Close", desc: "After the meeting, enter what was agreed. Get a formatted actions summary and follow-up note." },
                  ].map(s => (
                    <div key={s.n} style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "20px 22px" }}>
                      <div style={{ fontSize: 20, fontWeight: 600, color: COLORS.teal, marginBottom: 8, fontFamily: FONT.sans }}>{s.n}</div>
                      <p style={{ fontSize: 15, fontWeight: 600, color: COLORS.navy, margin: "0 0 4px", fontFamily: FONT.sans }}>{s.title}</p>
                      <p style={{ fontSize: 14, color: COLORS.navyMid, margin: 0, lineHeight: "20px", fontFamily: FONT.sans }}>{s.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── CLOSE STAGE ── */}
        {stage === "close" && (
          <>
            <div style={{ background: COLORS.white, borderRadius: 22, boxShadow: SHADOW, padding: "clamp(24px, 5vw, 48px)", marginBottom: 32 }}>
              <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", color: COLORS.navy, margin: "0 0 6px", fontFamily: FONT.sans }}>
                Close the meeting
              </h2>
              <p style={{ fontSize: 15, color: COLORS.navyMid, margin: "0 0 24px", fontFamily: FONT.sans, lineHeight: "22px" }}>
                {prepResult
                  ? `Closing: ${prepResult.meetingTitle}`
                  : "Enter what happened in the meeting to generate your actions summary and follow-up note."}
              </p>

              <TextField
                label="Actions agreed"
                value={closeForm.actionsNotes}
                onChange={cf("actionsNotes")}
                placeholder="e.g. Sarah to send revised brief by Friday. Tom to book client call for w/c 7 April. All to review deck before Thursday."
                hint="One action per line works well. Include owner and deadline where you know them."
                required multiline
              />
              <TextField
                label="Key decisions made"
                value={closeForm.decisionsNotes}
                onChange={cf("decisionsNotes")}
                placeholder="e.g. Agreed to pause Project X until Q4. Decided to use supplier B for print run."
                multiline
              />
              <TextField
                label="Anything left unresolved"
                value={closeForm.anythingUnresolved}
                onChange={cf("anythingUnresolved")}
                placeholder="e.g. Budget sign-off still needed from finance. Date for phase 2 kick-off TBC."
              />

              {error && <p style={{ fontSize: 13, color: COLORS.red2, margin: "0 0 10px", fontFamily: FONT.sans }}>{error}</p>}

              <button onClick={generateClose} disabled={loading}
                style={{ width: "100%", marginTop: 8, minHeight: 52, padding: "0 24px", background: COLORS.navy, opacity: loading ? 0.7 : 1, color: "#fff", border: "none", borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: FONT.sans, transition: "opacity 0.2s" }}>
                {loading ? "Generating your close-out..." : "Generate actions summary and follow-up"}
              </button>
            </div>

            {/* Close results */}
            {closeResult && (
              <div ref={closeResultsRef}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <h2 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", color: COLORS.navy, margin: 0, fontFamily: FONT.sans }}>Meeting close-out</h2>
                  <Badge color="green">Ready to send</Badge>
                </div>

                <OutputBox title="Actions summary" content={closeResult.actions} badge={{ color: "teal", label: "Share with everyone" }} spoken />
                <OutputBox title="Follow-up note" content={closeResult.followup} badge={{ color: "teal", label: "Send to the group" }} spoken />
                <OutputBox title="Process review" content={closeResult.review} badge={{ color: "blue", label: "Manager only" }} />

                <div style={{ background: COLORS.white, borderRadius: 10, padding: "16px 20px", border: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <p style={{ fontSize: 14, color: COLORS.navyMid, margin: 0, fontFamily: FONT.sans }}>All outputs are editable. Send within 24 hours while actions are fresh.</p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button onClick={downloadPdf} disabled={downloadingPdf} style={{ fontSize: 14, minHeight: 44, padding: "0 20px", background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.navy, cursor: downloadingPdf ? "default" : "pointer", fontFamily: FONT.sans, fontWeight: 600, opacity: downloadingPdf ? 0.7 : 1 }}>{downloadingPdf ? "Preparing PDF..." : (isPro ? "Download full PDF" : "Download full PDF (Pro)")}</button>
                    <a href={DASHBOARD_URL} style={{ fontSize: 14, minHeight: 44, padding: "0 20px", background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.navy, cursor: "pointer", fontFamily: FONT.sans, fontWeight: 600, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Back to dashboard</a>
                    <button onClick={resetAll} style={{ fontSize: 14, minHeight: 44, padding: "0 20px", background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, color: COLORS.navy, cursor: "pointer", fontFamily: FONT.sans, fontWeight: 500 }}>New meeting</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Footer ── */}
        <div style={{ borderTop: `1px solid ${COLORS.border}`, marginTop: 40, paddingTop: 20, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: COLORS.muted, margin: 0, fontFamily: FONT.sans }}>
            Meeting Ignite, part of <a href="https://management-ignition.com" style={{ color: COLORS.navyMid, textUnderlineOffset: 4 }}>Management Ignition</a>
            {!isPro && <> · {remaining} free {remaining === 1 ? "use" : "uses"} remaining · <span style={{ textDecoration: "underline", textUnderlineOffset: 4, cursor: "pointer", color: COLORS.navyMid }} onClick={() => { setUpgradeTrigger("manual"); setShowUpgrade(true); }}>Upgrade to Pro</span></>}
            {isPro && <> · <span style={{ color: COLORS.green, fontWeight: 600 }}>Pro, unlimited access</span></>}
          </p>
        </div>

      </div>
    </div>
  );
}
