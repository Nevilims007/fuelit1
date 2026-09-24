namespace FuelitAPI.Models;

public class Order
{
    public int Id { get; set; }

    public string OrderId { get; set; } = "";

    public int UserId { get; set; }

    public string FuelType { get; set; } = "";

    public decimal Amount { get; set; }

    public decimal Quantity { get; set; }

    public string Payment { get; set; } = "";

    public double Latitude { get; set; }

    public double Longitude { get; set; }

    public string Status { get; set; } = "Confirmed";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
