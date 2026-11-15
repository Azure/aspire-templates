using System.Globalization;
using System.Net;
using System.Text;
using Azure.Messaging.EventHubs.Producer;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using DroneDelivery.Domain;

namespace DroneDelivery.DroneSimulator;

/// <summary>Renders labelled, simulated camera frames, stores them as blobs and announces them on Event Hubs.</summary>
public sealed class DroneCamera(
    BlobContainerClient container,
    [FromKeyedServices(Hubs.DronePhotos)] EventHubProducerClient photos,
    ILogger<DroneCamera> logger)
{
    bool containerReady;

    public async Task CaptureAsync(SimulatedDrone drone, PhotoTrigger trigger, bool proofOfDelivery, DateTimeOffset now, CancellationToken cancellationToken)
    {
        try
        {
            if (!containerReady)
            {
                await container.CreateIfNotExistsAsync(cancellationToken: cancellationToken);
                containerReady = true;
            }
            var blobName = $"{drone.Id}/{now:yyyyMMddTHHmmssfff}-{trigger}.svg";
            var svg = Render(drone, trigger, proofOfDelivery, now);
            await container.GetBlobClient(blobName).UploadAsync(
                BinaryData.FromString(svg),
                new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = "image/svg+xml" } },
                cancellationToken);
            await photos.SendAsync(
                new PhotoCaptured(drone.Id, drone.Mission?.MissionId, drone.Mission?.OrderId, trigger, proofOfDelivery, blobName, drone.Position, Math.Round(drone.AltitudeMetres, 1), now),
                drone.Id,
                cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // A missed frame should never ground a drone.
            logger.LogWarning(exception, "Camera capture failed for {DroneId}", drone.Id);
        }
    }

    public static string Render(SimulatedDrone drone, PhotoTrigger trigger, bool proofOfDelivery, DateTimeOffset now)
    {
        var lookingDown = trigger != PhotoTrigger.Cruise;
        var random = new Random(HashCode.Combine(Math.Round(drone.Position.Latitude, 4), Math.Round(drone.Position.Longitude, 4)));
        var svg = new StringBuilder();
        svg.Append("""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480" font-family="monospace">""");
        if (lookingDown)
        {
            // Closer to the ground the scene is magnified.
            var zoom = 1 + (DroneSpec.CruiseAltitudeMetres - drone.AltitudeMetres) / DroneSpec.CruiseAltitudeMetres * 2;
            svg.Append("""<rect width="640" height="480" fill="#d9d2bf"/>""");
            svg.Append(Invariant($"""<g transform="translate(320 240) scale({zoom:0.00}) translate(-320 -240)">"""));
            for (var i = 0; i < 14; i++)
                svg.Append(Invariant($"""<rect x="{random.Next(0, 600)}" y="{random.Next(0, 440)}" width="{random.Next(30, 90)}" height="{random.Next(30, 90)}" fill="#b9b19c" stroke="#9c947e"/>"""));
            svg.Append("""<rect x="0" y="210" width="640" height="34" fill="#efe9da"/><rect x="290" y="0" width="34" height="480" fill="#efe9da"/>""");
            svg.Append("""<circle cx="320" cy="240" r="46" fill="#1d4a37"/><circle cx="320" cy="240" r="30" fill="none" stroke="#f5efe1" stroke-width="4"/>""");
            svg.Append("</g>");
        }
        else
        {
            svg.Append("""<rect width="640" height="200" fill="#dfe7e4"/><rect y="200" width="640" height="280" fill="#d4ccb7"/>""");
            for (var i = 0; i < 18; i++)
            {
                var height = random.Next(10, 60);
                svg.Append(Invariant($"""<rect x="{random.Next(0, 620)}" y="{200 - height}" width="{random.Next(16, 48)}" height="{height}" fill="#bfb7a2"/>"""));
            }
            svg.Append("""<path d="M300 480 L318 200 L322 200 L340 480 Z" fill="#c8bea6"/>""");
        }
        var order = drone.Mission?.OrderId ?? "no order";
        svg.Append("""<rect x="12" y="12" width="300" height="28" rx="4" fill="#21352c" opacity=".85"/><text x="24" y="31" fill="#f5efe1" font-size="14">SIMULATED CAMERA · NOT A REAL PHOTO</text>""");
        svg.Append(Invariant($"""<rect x="12" y="420" width="616" height="48" rx="4" fill="#21352c" opacity=".85"/>"""));
        svg.Append(Invariant($"""<text x="24" y="440" fill="#f5efe1" font-size="13">{Escape(drone.Id)} · {trigger}{(proofOfDelivery ? " · PROOF OF DELIVERY" : "")} · {Escape(order)}</text>"""));
        svg.Append(Invariant($"""<text x="24" y="458" fill="#f5efe1" font-size="13">ALT {drone.AltitudeMetres:0} m · {drone.Position.Latitude:0.00000}, {drone.Position.Longitude:0.00000} · {now:yyyy-MM-dd HH:mm:ss} UTC</text>"""));
        svg.Append("</svg>");
        return svg.ToString();
    }

    static string Invariant(FormattableString value) => value.ToString(CultureInfo.InvariantCulture);

    static string Escape(string value) => WebUtility.HtmlEncode(value);
}
