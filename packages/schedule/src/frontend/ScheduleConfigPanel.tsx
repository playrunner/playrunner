import React, { useState, useEffect, useRef } from "react";
import type { IntegrationConfigPanelProps } from "@playrunner/integration-sdk";
import { cn } from "./cn";
import {
  Clock,
  Calendar,
  CalendarDays,
  Timer,
  Repeat,
  Info,
  ExternalLink,
} from "lucide-react";

type FrequencyType = "minute" | "hour" | "day" | "week" | "month";

interface ScheduleConfig {
  frequency: FrequencyType;
  interval: number;
  time: string; // HH:mm for day/week/month
  minuteOfHour: number; // 0-59 for hour
  daysOfWeek: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  dayOfMonth: number; // 1-31
  timezone: string;
  enabled: boolean;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  frequency: "day",
  interval: 1,
  time: "09:00",
  minuteOfHour: 0,
  daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
  dayOfMonth: 1,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  enabled: true,
};

const FREQUENCY_OPTIONS: {
  value: FrequencyType;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "minute",
    label: "Every Minute",
    description: "Runs every N minutes",
    icon: <Timer className="w-4 h-4" />,
  },
  {
    value: "hour",
    label: "Hourly",
    description: "Runs every N hours",
    icon: <Clock className="w-4 h-4" />,
  },
  {
    value: "day",
    label: "Daily",
    description: "Runs every day at a set time",
    icon: <Calendar className="w-4 h-4" />,
  },
  {
    value: "week",
    label: "Weekly",
    description: "Runs on selected days each week",
    icon: <CalendarDays className="w-4 h-4" />,
  },
  {
    value: "month",
    label: "Monthly",
    description: "Runs on a specific day each month",
    icon: <Repeat className="w-4 h-4" />,
  },
];

const DAYS_OF_WEEK = [
  { value: 0, label: "Sun", short: "S" },
  { value: 1, label: "Mon", short: "M" },
  { value: 2, label: "Tue", short: "T" },
  { value: 3, label: "Wed", short: "W" },
  { value: 4, label: "Thu", short: "T" },
  { value: 5, label: "Fri", short: "F" },
  { value: 6, label: "Sat", short: "S" },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
];

type NextStepItem = {
  id: string;
  text: React.ReactNode;
};

const DEFAULT_DOCS_URL = "https://docs.playrunner.dev";
const GCP_SETUP_DOCS_URL = getDocsUrl("docs/cloud-architecture/gcp/setup");

type DocsImportMeta = ImportMeta & {
  env?: {
    VITE_DOCS_URL?: string;
  };
};

function getDocsUrl(path = "") {
  const baseUrl = (
    (import.meta as DocsImportMeta).env?.VITE_DOCS_URL || DEFAULT_DOCS_URL
  )
    .trim()
    .replace(/\/+$/, "");
  const normalizedPath = path.trim().replace(/^\/+/, "");

  return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

function renderGcpSetupDocsLink() {
  return (
    <a
      href={GCP_SETUP_DOCS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[var(--foreground)] underline underline-offset-4 hover:text-muted"
    >
      GCP setup guide
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export const ScheduleConfigPanel: React.FC<IntegrationConfigPanelProps> = ({
  nodeId,
  config,
  onChange,
  workflowCloudProvider,
}) => {
  const isCloudSchedulerAvailable = workflowCloudProvider === "GCP";
  const [schedule, setSchedule] = useState<ScheduleConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...config.schedule,
    enabled:
      workflowCloudProvider === "GCP"
        ? (config.schedule?.enabled ?? DEFAULT_CONFIG.enabled)
        : false,
  }));
  const latestConfigRef = useRef(config);

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  useEffect(() => {
    onChange(nodeId, { ...latestConfigRef.current, schedule });
  }, [nodeId, onChange, schedule]);

  useEffect(() => {
    if (!isCloudSchedulerAvailable && schedule.enabled) {
      setSchedule((prev) => ({ ...prev, enabled: false }));
    }
  }, [isCloudSchedulerAvailable, schedule.enabled]);

  const updateSchedule = (updates: Partial<ScheduleConfig>) => {
    setSchedule((prev) => ({ ...prev, ...updates }));
  };

  const toggleDay = (day: number) => {
    setSchedule((prev) => {
      const days = prev.daysOfWeek.includes(day)
        ? prev.daysOfWeek.filter((d) => d !== day)
        : [...prev.daysOfWeek, day].sort();
      return { ...prev, daysOfWeek: days };
    });
  };

  const getCronExpression = (): string => {
    const { frequency, interval, time, minuteOfHour, daysOfWeek, dayOfMonth } =
      schedule;
    const [hours, minutes] = time.split(":").map(Number);

    switch (frequency) {
      case "minute":
        return interval === 1 ? "* * * * *" : `*/${interval} * * * *`;
      case "hour":
        return interval === 1
          ? `${minuteOfHour} * * * *`
          : `${minuteOfHour} */${interval} * * *`;
      case "day":
        return `${minutes} ${hours} * * *`;
      case "week":
        return `${minutes} ${hours} * * ${daysOfWeek.join(",")}`;
      case "month":
        return `${minutes} ${hours} ${dayOfMonth} * *`;
      default:
        return "0 9 * * *";
    }
  };

  const getHumanReadable = (): string => {
    const { frequency, interval, time, minuteOfHour, daysOfWeek, dayOfMonth } =
      schedule;
    switch (frequency) {
      case "minute":
        return interval === 1 ? "Every minute" : `Every ${interval} minutes`;
      case "hour":
        return interval === 1
          ? `Every hour at :${String(minuteOfHour).padStart(2, "0")}`
          : `Every ${interval} hours at :${String(minuteOfHour).padStart(2, "0")}`;
      case "day":
        return `Every day at ${time}`;
      case "week": {
        const dayNames = daysOfWeek
          .map((d) => DAYS_OF_WEEK[d]?.label)
          .join(", ");
        return `Every ${dayNames} at ${time}`;
      }
      case "month":
        return `Monthly on day ${dayOfMonth} at ${time}`;
      default:
        return "";
    }
  };

  const scheduleStatusText = !isCloudSchedulerAvailable
    ? "Schedules require a cloud runner. Select GCP Runner to enable."
    : schedule.enabled
      ? "Active - workflow will run automatically"
      : "Paused - schedule is disabled";
  const nextStepItems: NextStepItem[] = !isCloudSchedulerAvailable
    ? [
        {
          id: "select-gcp-runner",
          text: "Select GCP Runner in the top bar before enabling this schedule.",
        },
        {
          id: "connect-gcp",
          text: (
            <>
              Open the Connect to GCP dialog and complete the{" "}
              {renderGcpSetupDocsLink()} before enabling schedules.
            </>
          ),
        },
      ]
    : schedule.enabled
      ? [
          {
            id: "gcp-setup",
            text: (
              <>
                Confirm the {renderGcpSetupDocsLink()} is complete, including
                Terraform infrastructure and pushed runner images.
              </>
            ),
          },
          {
            id: "save-workflow",
            text: (
              <>
                Save the workflow to create or update the Cloud Scheduler job.
                The job will call the Playrunner API endpoint{" "}
                <code className="font-mono text-[var(--foreground)]">
                  /api/scheduler/trigger/...
                </code>{" "}
                configured during Google Cloud setup.
              </>
            ),
          },
          {
            id: "scheduler-service-account",
            text: "Cloud Scheduler will use the scheduler service account saved in the Connect to GCP dialog.",
          },
        ]
      : [
          {
            id: "gcp-setup",
            text: (
              <>
                Complete the {renderGcpSetupDocsLink()} from the Connect to GCP
                dialog before this schedule can be provisioned.
              </>
            ),
          },
          {
            id: "enable-save",
            text: "Enable the schedule, then save the workflow to provision Cloud Scheduler.",
          },
        ];

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between bg-[var(--background)] border border-subtle rounded-lg p-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-2.5 h-2.5 rounded-full transition-colors",
              schedule.enabled
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                : "bg-zinc-600",
            )}
          />
          <div>
            <span className="text-sm font-medium text-[var(--foreground)]">
              Schedule
            </span>
            <p className="text-xs text-muted mt-0.5">{scheduleStatusText}</p>
          </div>
        </div>
        <button
          disabled={!isCloudSchedulerAvailable}
          onClick={() => {
            if (isCloudSchedulerAvailable) {
              updateSchedule({ enabled: !schedule.enabled });
            }
          }}
          className={cn(
            "relative w-11 h-6 rounded-full transition-colors duration-200",
            schedule.enabled && isCloudSchedulerAvailable
              ? "bg-emerald-500"
              : "bg-[var(--surface-hover)]",
            !isCloudSchedulerAvailable && "cursor-not-allowed opacity-70",
          )}
          title={
            isCloudSchedulerAvailable
              ? schedule.enabled
                ? "Disable schedule"
                : "Enable schedule"
              : "Schedules require GCP Runner"
          }
        >
          <div
            className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-[var(--foreground)] shadow transition-transform duration-200",
              schedule.enabled && isCloudSchedulerAvailable
                ? "translate-x-[22px]"
                : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Frequency Selection */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">
          Frequency
        </h4>
        <div className="grid grid-cols-5 gap-2">
          {FREQUENCY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateSchedule({ frequency: opt.value })}
              className={cn(
                "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all duration-200 text-center",
                schedule.frequency === opt.value
                  ? "bg-[var(--surface-hover)] border-[var(--border-strong)] text-[var(--foreground)]"
                  : "bg-[var(--background)] border-subtle text-muted hover:text-[var(--foreground)] hover:border-[var(--border-strong)]",
              )}
            >
              <div
                className={cn(
                  "transition-colors",
                  schedule.frequency === opt.value
                    ? "text-[var(--foreground)]"
                    : "text-muted",
                )}
              >
                {opt.icon}
              </div>
              <span className="text-xs font-medium">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Interval (for minute/hour) */}
      {(schedule.frequency === "minute" || schedule.frequency === "hour") && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">
            Interval
          </h4>
          <div className="flex items-center gap-3 bg-[var(--background)] border border-subtle rounded-lg p-4">
            <span className="text-sm text-muted whitespace-nowrap">
              Run every
            </span>
            <input
              type="number"
              min={1}
              max={schedule.frequency === "minute" ? 59 : 23}
              value={schedule.interval}
              onChange={(e) =>
                updateSchedule({
                  interval: Math.max(1, parseInt(e.target.value) || 1),
                })
              }
              className="w-20 bg-[var(--control-bg)] border border-subtle rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] text-center focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-all"
            />
            <span className="text-sm text-muted">
              {schedule.frequency === "minute" ? "minute(s)" : "hour(s)"}
            </span>
          </div>
        </div>
      )}

      {/* Minute of hour (for hourly) */}
      {schedule.frequency === "hour" && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">
            At Minute
          </h4>
          <div className="flex items-center gap-3 bg-[var(--background)] border border-subtle rounded-lg p-4">
            <span className="text-sm text-muted whitespace-nowrap">
              At minute
            </span>
            <input
              type="number"
              min={0}
              max={59}
              value={schedule.minuteOfHour}
              onChange={(e) =>
                updateSchedule({
                  minuteOfHour: Math.min(
                    59,
                    Math.max(0, parseInt(e.target.value) || 0),
                  ),
                })
              }
              className="w-20 bg-[var(--control-bg)] border border-subtle rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] text-center focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-all"
            />
            <span className="text-sm text-muted">of each hour</span>
          </div>
        </div>
      )}

      {/* Time picker (for day/week/month) */}
      {(schedule.frequency === "day" ||
        schedule.frequency === "week" ||
        schedule.frequency === "month") && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">
            Time
          </h4>
          <div className="flex items-center gap-3 bg-[var(--background)] border border-subtle rounded-lg p-4">
            <Clock className="w-4 h-4 text-muted" />
            <span className="text-sm text-muted">Run at</span>
            <input
              type="time"
              value={schedule.time}
              onChange={(e) => updateSchedule({ time: e.target.value })}
              className="bg-[var(--control-bg)] border border-subtle rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-all [color-scheme:dark]"
            />
          </div>
        </div>
      )}

      {/* Days of Week (for weekly) */}
      {schedule.frequency === "week" && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">
            Days of Week
          </h4>
          <div className="flex gap-2">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day.value}
                onClick={() => toggleDay(day.value)}
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-xs font-medium border transition-all duration-200",
                  schedule.daysOfWeek.includes(day.value)
                    ? "bg-[var(--surface-hover)] border-[var(--border-strong)] text-[var(--foreground)]"
                    : "bg-[var(--background)] border-subtle text-muted hover:text-[var(--foreground)] hover:border-[var(--border-strong)]",
                )}
                title={day.label}
              >
                {day.short}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted">
            Selected:{" "}
            {schedule.daysOfWeek.length === 0
              ? "None"
              : schedule.daysOfWeek
                  .map((d) => DAYS_OF_WEEK[d]?.label)
                  .join(", ")}
          </p>
        </div>
      )}

      {/* Day of Month (for monthly) */}
      {schedule.frequency === "month" && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">
            Day of Month
          </h4>
          <div className="flex items-center gap-3 bg-[var(--background)] border border-subtle rounded-lg p-4">
            <CalendarDays className="w-4 h-4 text-muted" />
            <span className="text-sm text-muted whitespace-nowrap">On day</span>
            <input
              type="number"
              min={1}
              max={31}
              value={schedule.dayOfMonth}
              onChange={(e) =>
                updateSchedule({
                  dayOfMonth: Math.min(
                    31,
                    Math.max(1, parseInt(e.target.value) || 1),
                  ),
                })
              }
              className="w-20 bg-[var(--control-bg)] border border-subtle rounded-md px-3 py-1.5 text-sm text-[var(--foreground)] text-center focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-all"
            />
            <span className="text-sm text-muted">of the month</span>
          </div>
        </div>
      )}

      {/* Timezone */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-[var(--foreground)] border-b border-subtle pb-2">
          Timezone
        </h4>
        <div className="bg-[var(--background)] border border-subtle rounded-lg p-4">
          <select
            value={schedule.timezone}
            onChange={(e) => updateSchedule({ timezone: e.target.value })}
            className="w-full bg-[var(--control-bg)] border border-subtle rounded-md px-3 py-2 text-sm text-[var(--foreground)] appearance-none focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)] transition-all cursor-pointer"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-[var(--surface-hover)] border border-subtle rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-muted mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Schedule Summary
            </p>
            <p className="text-sm text-muted">{getHumanReadable()}</p>
          </div>
        </div>
        <div className="bg-[var(--background)] rounded-md p-2.5 border border-subtle">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted uppercase tracking-wider">
              Cron
            </span>
            <code className="text-xs font-mono text-[var(--foreground)]">
              {getCronExpression()}
            </code>
          </div>
        </div>
        <p className="text-[10px] text-muted">
          Timezone: {schedule.timezone.replace(/_/g, " ")}
        </p>
      </div>

      <div className="bg-[var(--background)] border border-subtle rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-muted mt-0.5 shrink-0" />
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Next Steps
            </p>
            <ul className="space-y-1.5 text-xs text-muted leading-relaxed">
              {nextStepItems.map((item) => (
                <li key={item.id} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
                  <span className="min-w-0 flex-1">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
