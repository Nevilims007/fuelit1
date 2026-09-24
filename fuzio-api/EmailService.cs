using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

public class EmailService
{
    private readonly IConfiguration _configuration;

    public EmailService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public async Task SendOrderConfirmationAsync(
        string toEmail,
        string orderId,
        string fuelType,
        decimal quantity,
        string payment,
        decimal total)
    {
        var username = _configuration["Email:Username"];
        var password = _configuration["Email:Password"];

        var message = new MimeMessage();

        message.From.Add(
            new MailboxAddress(
                "Fuelit",
                username
            )
        );

        message.To.Add(
            MailboxAddress.Parse(toEmail)
        );

        message.Subject =
            "Fuelit Order Confirmation - " + orderId;

        message.Body =
            new TextPart("plain")
            {
                Text =
$@"Fuelit Order Confirmed!

Order ID: {orderId}

Fuel: {fuelType}
Quantity: {quantity:F2} L
Payment: {payment}
Total: ₹{total}

Status: Confirmed

Thank you for using Fuelit."
            };


        using var smtp =
            new SmtpClient();


        await smtp.ConnectAsync(
            "smtp.gmail.com",
            587,
            SecureSocketOptions.StartTls
        );


        await smtp.AuthenticateAsync(
            username,
            password
        );


        Console.WriteLine("Trying to send email to: " + toEmail);

        await smtp.SendAsync(message);

        Console.WriteLine("Email sent successfully to: " + toEmail);


        await smtp.DisconnectAsync(
            true
        );
    }

        public async Task SendEVBookingConfirmationAsync(
        string toEmail,
        string bookingId,
        string stationName,
        string chargerType,
        string timeSlot,
        decimal pricePerKwh)
    {
        var username = _configuration["Email:Username"];
        var password = _configuration["Email:Password"];

        var message = new MimeMessage();

        message.From.Add(
            new MailboxAddress(
                "Fuelit",
                username
            )
        );

        message.To.Add(
            MailboxAddress.Parse(toEmail)
        );

        message.Subject =
            "Fuelit EV Booking Confirmation - " + bookingId;

        message.Body =
            new TextPart("plain")
            {
                Text =
    $@"Fuelit EV Booking Confirmed!

    Booking ID: {bookingId}

    Station: {stationName}
    Charger Type: {chargerType}
    Time Slot: {timeSlot}
    Price: ₹{pricePerKwh} / kWh

    Status: Booked

    Thank you for using Fuelit."
            };


        using var smtp =
            new SmtpClient();


        await smtp.ConnectAsync(
            "smtp.gmail.com",
            587,
            SecureSocketOptions.StartTls
        );


        await smtp.AuthenticateAsync(
            username,
            password
        );


        Console.WriteLine(
            "Trying to send EV email to: " + toEmail
        );


        await smtp.SendAsync(message);


        Console.WriteLine(
            "EV email sent successfully to: " + toEmail
        );


        await smtp.DisconnectAsync(
            true
        );
    }
}
