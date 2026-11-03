// Where customers send the subscription payment (Vodafone Cash / InstaPay) and the receipt screenshot (WhatsApp).
export const PAY_NUMBER = "01025421865";
export const WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || "201025421865").replace(/\D/g, "");
