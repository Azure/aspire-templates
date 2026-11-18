namespace DroneDelivery.Domain;

public static class DroneCommands
{
    public static string? Error(DroneState state, bool carryingPackage, DroneCommand command) =>
        !Enum.IsDefined(command) ? "Unknown drone command." :
        command == DroneCommand.Reactivate && state != DroneState.Grounded ? "Only a grounded drone can be reactivated." :
        command != DroneCommand.Reactivate && state == DroneState.Grounded ? "Reactivate this grounded drone first." :
        command == DroneCommand.DiscardPackage && !carryingPackage ? "This drone is not carrying a package." : null;
}
