export interface SharedScheduleStoreTask {
  id: number;
  shared_schedule_id: number;
  store_task_id: number;
  start_time_as_min: number;
  end_time_as_min: number;
  memo: string | null;
}

export interface Schedule {
  id: number;
  date: string;
  start_hour: number | null;
  start_minute: number | null;
  end_hour: number | null;
  end_minute: number | null;
  off: boolean;
  off_type: string;
  rest_times: unknown[] | null;
  memo_text: string | null;
  attending_store_id: number;
  attending_genre_id: number;
  belonging_store_id: number;
  belonging_genre_id: number;
  shared_schedule_store_tasks: SharedScheduleStoreTask[];
}

export interface UserSubmitTerm {
  start_date: string;
  end_date: string;
  store_id: number;
  genre_id: number;
  schedules: Schedule[];
}

export interface ShiftApiResponse {
  user_submit_terms: UserSubmitTerm[];
  confirmed_dates: Record<string, boolean>;
  confirmed_dawns: unknown[];
  hide_shift_table_for_staff: boolean;
}

export interface SalarySettings {
  hourlyRate: number;
  transportCost: number;
}

export interface ShiftDetail {
  date: string;
  startTime: string;
  endTime: string;
  totalHours: number;
  normalHours: number;
  lateNightHours: number;
  isOff: boolean;
}

export interface SalaryResult {
  shifts: ShiftDetail[];
  totalWorkDays: number;
  totalHours: number;
  totalNormalHours: number;
  totalLateNightHours: number;
  normalPay: number;
  lateNightPay: number;
  transportTotal: number;
  totalPay: number;
}
