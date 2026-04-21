const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendOrderNotification(order) {
  const itemsList = (order.items || [])
    .map(i => `• ${i.name} x${i.qty} — Rs.${i.price}`)
    .join('\n');

  await transporter.sendMail({
    from: `"Nikkashi Orders" <${process.env.GMAIL_USER}>`,
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
}

module.exports = { sendOrderNotification };
