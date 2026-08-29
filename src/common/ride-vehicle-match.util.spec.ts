import { doesVehicleMatchRideCategory } from './ride-vehicle-match.util';
import { RideCategory } from './enums/ride.enum';
import { VehicleCategory } from './enums/vehicle.enum';

describe('doesVehicleMatchRideCategory', () => {
  it('matches a plain car for Economy by default', () => {
    const car = { category: VehicleCategory.CAR, approvedRideCategories: null };
    expect(doesVehicleMatchRideCategory(car, RideCategory.ECONOMY)).toBe(true);
  });

  it('does NOT match a plain car for Comfort by default (this was the bug: every car matched every category)', () => {
    const car = { category: VehicleCategory.CAR, approvedRideCategories: null };
    expect(doesVehicleMatchRideCategory(car, RideCategory.COMFORT)).toBe(false);
  });

  it('matches a car for Comfort once an admin has approved it for that category', () => {
    const approvedCar = {
      category: VehicleCategory.CAR,
      approvedRideCategories: [RideCategory.COMFORT],
    };
    expect(doesVehicleMatchRideCategory(approvedCar, RideCategory.COMFORT)).toBe(true);
  });

  it('does not let approval for one category leak into another', () => {
    const approvedForComfortOnly = {
      category: VehicleCategory.SUV,
      approvedRideCategories: [RideCategory.COMFORT],
    };
    // An SUV isn't the default Economy vehicle category, and it wasn't approved for Economy.
    expect(doesVehicleMatchRideCategory(approvedForComfortOnly, RideCategory.ECONOMY)).toBe(false);
  });

  it('never matches a non-car category (e.g. motorcycle) for Economy without explicit approval', () => {
    const motorcycle = { category: VehicleCategory.MOTORCYCLE, approvedRideCategories: null };
    expect(doesVehicleMatchRideCategory(motorcycle, RideCategory.ECONOMY)).toBe(false);
  });
});
