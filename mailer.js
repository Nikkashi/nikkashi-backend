const { Resend } = require('resend');

async function sendOrderNotification(order) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const itemsList = (order.items || [])
    .map(i => `• ${i.name} x${i.qty} — Rs.${i.price}`)
    .join('\n');

  console.log('[MAIL] Attempting send to:', process.env.NOTIFY_EMAIL);

  const { data, error } = await resend.emails.send({
    from: 'Nikkashi Orders <onboarding@resend.dev>',
    to: process.env.NOTIFY_EMAIL,
    subject: `New Order #${order.id} — Rs.${order.total}`,
    text: `
New order on Nikkashi!

Order ID : ${order.id}
Customer : ${order.customerName}
Phone    : ${order.phone}
Address  : ${order.address || 'Not provided'}

Items:
${itemsList}

Total   : Rs.${order.total}
Payment : ${order.paymentStatus || 'Paid'}
Time    : ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
    `.trim(),
  });

  if (error) {
    console.error('[MAIL] Resend error:', JSON.stringify(error));
  } else {
    console.log('[MAIL] Sent OK:', data.id);
  }
}

module.exports = { sendOrderNotification };
