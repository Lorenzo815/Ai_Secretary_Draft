import { afterEach, describe, expect, it, vi } from "vitest";
import { createCalendarFormatters } from "./presentation";

afterEach(() => vi.restoreAllMocks());

describe("reusable calendar presentation", () => {
  it("keeps local dates correct across UTC midnight and daylight saving transitions", () => {
    const brazil = createCalendarFormatters("America/Sao_Paulo");
    expect(brazil.dateKey("2026-10-28T01:00:00Z")).toBe("2026-10-27");
    expect(brazil.dateKey("2026-10-28T03:00:00Z")).toBe("2026-10-28");
    const newYork = createCalendarFormatters("America/New_York");
    expect(newYork.appointmentRange("2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z"))
      .toMatchObject({ timeLabel: "01:30\u201303:30", durationLabel: "1h" });
  });

  it("preserves same-day and overnight appointment labels", () => {
    const formatters = createCalendarFormatters("America/Sao_Paulo");
    expect(formatters.appointmentRange("2026-10-28T12:00:00Z", "2026-10-28T13:30:00Z"))
      .toMatchObject({ timeLabel: "09:00\u201310:30", durationLabel: "1h30" });
    const overnight = formatters.appointmentRange("2026-10-29T02:30:00Z", "2026-10-29T03:30:00Z");
    expect(overnight.dateLabel).toContain("28/10");
    expect(overnight.timeLabel).toContain("29/10");
    expect(overnight.timeLabel).toContain("00:30");
    expect(overnight.durationLabel).toBe("1h");
    expect(formatters.shortDate("2026-10-28")).toBe("28/10");
  });

  it("allocates only eight date formatters even when formatting 1000 appointment rows", () => {
    const Constructor = Intl.DateTimeFormat;
    const constructors = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locales, options) {
      return new Constructor(locales, options);
    });
    const formatters = createCalendarFormatters("America/Sao_Paulo");

    for (let index = 0; index < 1000; index += 1) {
      formatters.appointmentRange("2026-10-28T12:00:00Z", "2026-10-28T12:30:00Z");
      formatters.dateKey("2026-10-28T12:00:00Z");
      formatters.dayLabel("2026-10-28");
    }

    expect(constructors).toHaveBeenCalledTimes(8);
  });
});
