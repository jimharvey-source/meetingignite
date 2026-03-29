import Stripe from "stripe";

const PRICES = {
  monthly: "price_1TG1cYPNGM6yegi0VG1IX055",
  annual: "price_1TG1d9PNGM6yegi0UxNMzuJt",
  lifetime: "price_1TG1djPNGM6yegi0dHJK5YEZ",
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    console.error("STRIPE_SECRET_KEY is not set");
    return res.status(500).json({ error: "Payment configuration error." });
  }

  const stripe = new Stripe(secretKey);
  const { plan, origin } = req.body;

  if (!plan || !PRICES[plan]) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  try {
    const isSubscription = plan === "monthly" || plan === "annual";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: PRICES[plan], quantity: 1 }],
      mode: isSubscription ? "subscription" : "payment",
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url: `${origin}/?cancelled=true`,
      billing_address_collection: "auto",
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
}
