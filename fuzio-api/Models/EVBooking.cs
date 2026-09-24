namespace FuelitAPI.Models;

public class EVBooking
{
    public int Id { get; set; }

    public string BookingId { get; set; } = "";

    public int UserId { get; set; }

    public string StationName { get; set; } = "";

    public string ChargerType { get; set; } = "";

    public decimal PricePerKwh { get; set; }

    public string TimeSlot { get; set; } = "";

    public string Status { get; set; } = "Booked";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
