// src/modules/project-finance/project-finance.service.ts

import { Types } from 'mongoose';
import {
  isProjectFinanceActualType,
  isProjectFinanceForecastType,
  isProjectFinanceInvoiceType,
  ProjectFinanceDirection,
  ProjectFinanceRecord,
  ProjectFinanceRecordDocument,
  ProjectFinanceStatus,
  ProjectFinanceType,
} from './project-finance.model';

const USER_SELECT =
  'firstName lastName fullName username email role roleLabel isActive';

export const buildProjectFinanceFileUrl = (fileName: string): string => {
  return `/api/v1/uploads/projects/${fileName}`;
};

export const isIncomeFinanceType = (type: ProjectFinanceType): boolean => {
  return (
    type === ProjectFinanceType.INCOME_FORECAST ||
    type === ProjectFinanceType.RECEIVABLE_INVOICE ||
    type === ProjectFinanceType.ACTUAL_RECEIPT
  );
};

export const getActualTypeForDirection = (
  direction: ProjectFinanceDirection,
): ProjectFinanceType => {
  return direction === ProjectFinanceDirection.EXPENSE
    ? ProjectFinanceType.ACTUAL_PAYMENT
    : ProjectFinanceType.ACTUAL_RECEIPT;
};

export const getActualTypeForTarget = (
  target: ProjectFinanceRecordDocument,
): ProjectFinanceType => {
  return getActualTypeForDirection(target.direction as ProjectFinanceDirection);
};

export const populateFinanceRecordQuery = (query: any) => {
  return query
    .populate('registeredById', USER_SELECT)
    .populate('approvedById', USER_SELECT)
    .populate('attachments.uploadedBy', USER_SELECT)
    .populate('linkedForecastId', 'title type typeLabel finalAmount achievedAmount remainingAmount achievementPercent status statusLabel')
    .populate('linkedInvoiceId', 'title invoiceNumber type typeLabel finalAmount achievedAmount remainingAmount achievementPercent status statusLabel');
};

const roundMoney = (value: number): number => {
  return Math.round((Number(value) || 0) * 100) / 100;
};

const roundPercent = (value: number): number => {
  return Math.min(Math.round((Number(value) || 0) * 100) / 100, 100);
};

const calculateStatusByAchievement = (
  record: ProjectFinanceRecordDocument,
  achievedAmount: number,
): ProjectFinanceStatus => {
  if (
    record.status === ProjectFinanceStatus.CANCELLED ||
    record.status === ProjectFinanceStatus.REJECTED ||
    record.status === ProjectFinanceStatus.DRAFT
  ) {
    return record.status;
  }

  const finalAmount = Number(record.finalAmount) || 0;
  const dueDate = record.dueDate ? new Date(record.dueDate) : null;
  const isPastDue = Boolean(dueDate && dueDate.getTime() < Date.now());

  if (finalAmount > 0 && achievedAmount >= finalAmount) {
    return ProjectFinanceStatus.ACHIEVED;
  }

  if (isPastDue && finalAmount > achievedAmount) {
    return ProjectFinanceStatus.OVERDUE;
  }

  if (achievedAmount > 0) {
    return ProjectFinanceStatus.PARTIALLY_ACHIEVED;
  }

  return record.status === ProjectFinanceStatus.APPROVED
    ? ProjectFinanceStatus.APPROVED
    : ProjectFinanceStatus.SUBMITTED;
};

const sumActualsForInvoice = async (
  record: ProjectFinanceRecordDocument,
): Promise<number> => {
  const actualType = getActualTypeForTarget(record);

  const result = await ProjectFinanceRecord.aggregate([
    {
      $match: {
        projectId: record.projectId,
        type: actualType,
        linkedInvoiceId: record._id,
        status: { $nin: [ProjectFinanceStatus.CANCELLED, ProjectFinanceStatus.REJECTED] },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$finalAmount' },
      },
    },
  ]);

  return roundMoney(result[0]?.total || 0);
};

const sumActualsForForecast = async (
  record: ProjectFinanceRecordDocument,
): Promise<number> => {
  const actualType = getActualTypeForTarget(record);

  const linkedInvoices = await ProjectFinanceRecord.find({
    projectId: record.projectId,
    linkedForecastId: record._id,
    type:
      record.direction === ProjectFinanceDirection.EXPENSE
        ? ProjectFinanceType.PAYABLE_INVOICE
        : ProjectFinanceType.RECEIVABLE_INVOICE,
    status: { $ne: ProjectFinanceStatus.CANCELLED },
  })
    .select('_id')
    .lean();

  const linkedInvoiceIds = linkedInvoices.map((invoice) => invoice._id);

  const orFilters: Record<string, unknown>[] = [{ linkedForecastId: record._id }];

  if (linkedInvoiceIds.length) {
    orFilters.push({ linkedInvoiceId: { $in: linkedInvoiceIds } });
  }

  const result = await ProjectFinanceRecord.aggregate([
    {
      $match: {
        projectId: record.projectId,
        type: actualType,
        status: { $nin: [ProjectFinanceStatus.CANCELLED, ProjectFinanceStatus.REJECTED] },
        $or: orFilters,
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$finalAmount' },
      },
    },
  ]);

  return roundMoney(result[0]?.total || 0);
};

export const recalculateFinanceRecordAchievement = async (
  recordId: Types.ObjectId | string,
): Promise<ProjectFinanceRecordDocument | null> => {
  const record = await ProjectFinanceRecord.findById(recordId);

  if (!record) return null;

  if (isProjectFinanceActualType(record.type as ProjectFinanceType)) {
    record.achievedAmount = record.finalAmount;
    record.remainingAmount = 0;
    record.achievementPercent = record.finalAmount > 0 ? 100 : 0;
    await record.save();
    return record;
  }

  if (!isProjectFinanceForecastType(record.type as ProjectFinanceType) &&
      !isProjectFinanceInvoiceType(record.type as ProjectFinanceType)) {
    return record;
  }

  const achievedAmount = isProjectFinanceInvoiceType(record.type as ProjectFinanceType)
    ? await sumActualsForInvoice(record)
    : await sumActualsForForecast(record);

  const finalAmount = Number(record.finalAmount) || 0;

  record.achievedAmount = Math.min(achievedAmount, finalAmount);
  record.remainingAmount = Math.max(finalAmount - achievedAmount, 0);
  record.achievementPercent = finalAmount
    ? roundPercent((record.achievedAmount / finalAmount) * 100)
    : 0;
  record.status = calculateStatusByAchievement(record, record.achievedAmount);

  await record.save();

  return record;
};

export const recalculateLinkedFinanceRecords = async (
  record: ProjectFinanceRecordDocument,
): Promise<void> => {
  const ids = [record.linkedInvoiceId, record.linkedForecastId]
    .filter(Boolean)
    .map((item) => String(item));

  for (const id of ids) {
    await recalculateFinanceRecordAchievement(id);
  }
};

export const markOverdueFinanceRecords = async (
  projectId?: Types.ObjectId | string,
): Promise<void> => {
  const filter: Record<string, unknown> = {
    type: {
      $in: [
        ProjectFinanceType.INCOME_FORECAST,
        ProjectFinanceType.EXPENSE_FORECAST,
        ProjectFinanceType.RECEIVABLE_INVOICE,
        ProjectFinanceType.PAYABLE_INVOICE,
      ],
    },
    dueDate: { $lt: new Date() },
    remainingAmount: { $gt: 0 },
    status: {
      $nin: [
        ProjectFinanceStatus.ACHIEVED,
        ProjectFinanceStatus.OVERDUE,
        ProjectFinanceStatus.REJECTED,
        ProjectFinanceStatus.CANCELLED,
        ProjectFinanceStatus.DRAFT,
      ],
    },
  };

  if (projectId) {
    filter.projectId = new Types.ObjectId(String(projectId));
  }

  await ProjectFinanceRecord.updateMany(filter, {
    $set: {
      status: ProjectFinanceStatus.OVERDUE,
    },
  });
};

export type FinanceSummaryResult = {
  totalIncomeForecast: number;
  totalExpenseForecast: number;
  totalReceivableInvoices: number;
  totalPayableInvoices: number;
  totalActualReceipts: number;
  totalActualPayments: number;
  incomeAchievementPercent: number;
  expenseRealizationPercent: number;
  forecastProfit: number;
  actualProfit: number;
  profitVariance: number;
  overdueReceivableAmount: number;
  overduePayableAmount: number;
  pendingApprovalAmount: number;
  rejectedAmount: number;
  recordsWithoutReasonCount: number;
};

const emptySummary = (): FinanceSummaryResult => ({
  totalIncomeForecast: 0,
  totalExpenseForecast: 0,
  totalReceivableInvoices: 0,
  totalPayableInvoices: 0,
  totalActualReceipts: 0,
  totalActualPayments: 0,
  incomeAchievementPercent: 0,
  expenseRealizationPercent: 0,
  forecastProfit: 0,
  actualProfit: 0,
  profitVariance: 0,
  overdueReceivableAmount: 0,
  overduePayableAmount: 0,
  pendingApprovalAmount: 0,
  rejectedAmount: 0,
  recordsWithoutReasonCount: 0,
});

export const buildProjectFinanceSummary = async (
  projectId: Types.ObjectId | string,
): Promise<FinanceSummaryResult> => {
  await markOverdueFinanceRecords(projectId);

  const records = await ProjectFinanceRecord.find({
    projectId: new Types.ObjectId(String(projectId)),
    status: { $ne: ProjectFinanceStatus.CANCELLED },
  }).lean();

  const summary = emptySummary();

  records.forEach((record) => {
    const finalAmount = Number(record.finalAmount) || 0;
    const remainingAmount = Number(record.remainingAmount) || 0;

    if (record.type === ProjectFinanceType.INCOME_FORECAST) {
      summary.totalIncomeForecast += finalAmount;
    }

    if (record.type === ProjectFinanceType.EXPENSE_FORECAST) {
      summary.totalExpenseForecast += finalAmount;
    }

    if (record.type === ProjectFinanceType.RECEIVABLE_INVOICE) {
      summary.totalReceivableInvoices += finalAmount;

      if (record.status === ProjectFinanceStatus.OVERDUE) {
        summary.overdueReceivableAmount += remainingAmount;
      }
    }

    if (record.type === ProjectFinanceType.PAYABLE_INVOICE) {
      summary.totalPayableInvoices += finalAmount;

      if (record.status === ProjectFinanceStatus.OVERDUE) {
        summary.overduePayableAmount += remainingAmount;
      }
    }

    if (record.type === ProjectFinanceType.ACTUAL_RECEIPT) {
      summary.totalActualReceipts += finalAmount;
    }

    if (record.type === ProjectFinanceType.ACTUAL_PAYMENT) {
      summary.totalActualPayments += finalAmount;
    }

    if (record.status === ProjectFinanceStatus.SUBMITTED) {
      summary.pendingApprovalAmount += finalAmount;
    }

    if (record.status === ProjectFinanceStatus.REJECTED) {
      summary.rejectedAmount += finalAmount;
    }

    const isUnachievedInvoiceOrForecast =
      (isProjectFinanceForecastType(record.type as ProjectFinanceType) ||
        isProjectFinanceInvoiceType(record.type as ProjectFinanceType)) &&
      record.status === ProjectFinanceStatus.OVERDUE &&
      remainingAmount > 0;

    if (isUnachievedInvoiceOrForecast && !String(record.notAchievedReason || '').trim()) {
      summary.recordsWithoutReasonCount += 1;
    }
  });

  summary.incomeAchievementPercent = summary.totalIncomeForecast
    ? roundPercent((summary.totalActualReceipts / summary.totalIncomeForecast) * 100)
    : 0;

  summary.expenseRealizationPercent = summary.totalExpenseForecast
    ? roundPercent((summary.totalActualPayments / summary.totalExpenseForecast) * 100)
    : 0;

  summary.forecastProfit = roundMoney(
    summary.totalIncomeForecast - summary.totalExpenseForecast,
  );
  summary.actualProfit = roundMoney(
    summary.totalActualReceipts - summary.totalActualPayments,
  );
  summary.profitVariance = roundMoney(summary.actualProfit - summary.forecastProfit);

  return Object.fromEntries(
    Object.entries(summary).map(([key, value]) => [key, roundMoney(value as number)]),
  ) as FinanceSummaryResult;
};

export const buildProjectInvoiceReport = async (projectId: Types.ObjectId | string) => {
  await markOverdueFinanceRecords(projectId);

  const invoices = await populateFinanceRecordQuery(
    ProjectFinanceRecord.find({
      projectId: new Types.ObjectId(String(projectId)),
      type: {
        $in: [
          ProjectFinanceType.RECEIVABLE_INVOICE,
          ProjectFinanceType.PAYABLE_INVOICE,
        ],
      },
      status: { $ne: ProjectFinanceStatus.CANCELLED },
    }).sort({ dueDate: 1, createdAt: -1 }),
  );

  return invoices.map((invoice: any) => {
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    const delayDays =
      dueDate && invoice.remainingAmount > 0 && dueDate.getTime() < Date.now()
        ? Math.ceil((Date.now() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

    return {
      id: invoice._id?.toString(),
      invoiceNumber: invoice.invoiceNumber || '',
      title: invoice.title,
      type: invoice.type,
      typeLabel: invoice.typeLabel,
      direction: invoice.direction,
      directionLabel: invoice.directionLabel,
      counterparty: invoice.counterparty || {},
      finalAmount: invoice.finalAmount,
      achievedAmount: invoice.achievedAmount,
      remainingAmount: invoice.remainingAmount,
      achievementPercent: invoice.achievementPercent,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      delayDays,
      status: invoice.status,
      statusLabel: invoice.statusLabel,
      notAchievedReason: invoice.notAchievedReason || '',
      delayReason: invoice.delayReason || '',
      registeredBy: invoice.registeredById || null,
      approvedBy: invoice.approvedById || null,
      attachmentsCount: Array.isArray(invoice.attachments) ? invoice.attachments.length : 0,
      attachments: invoice.attachments || [],
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
    };
  });
};

export const buildProjectForecastReport = async (projectId: Types.ObjectId | string) => {
  await markOverdueFinanceRecords(projectId);

  const forecasts = await populateFinanceRecordQuery(
    ProjectFinanceRecord.find({
      projectId: new Types.ObjectId(String(projectId)),
      type: {
        $in: [
          ProjectFinanceType.INCOME_FORECAST,
          ProjectFinanceType.EXPENSE_FORECAST,
        ],
      },
      status: { $ne: ProjectFinanceStatus.CANCELLED },
    }).sort({ forecastDate: 1, dueDate: 1, createdAt: -1 }),
  );

  const forecastIds = forecasts.map((forecast: any) => forecast._id);

  const [linkedInvoices, linkedActuals] = await Promise.all([
    ProjectFinanceRecord.aggregate([
      {
        $match: {
          projectId: new Types.ObjectId(String(projectId)),
          linkedForecastId: { $in: forecastIds },
          type: {
            $in: [
              ProjectFinanceType.RECEIVABLE_INVOICE,
              ProjectFinanceType.PAYABLE_INVOICE,
            ],
          },
          status: { $ne: ProjectFinanceStatus.CANCELLED },
        },
      },
      {
        $group: {
          _id: '$linkedForecastId',
          count: { $sum: 1 },
          total: { $sum: '$finalAmount' },
        },
      },
    ]),
    ProjectFinanceRecord.aggregate([
      {
        $match: {
          projectId: new Types.ObjectId(String(projectId)),
          linkedForecastId: { $in: forecastIds },
          type: {
            $in: [ProjectFinanceType.ACTUAL_RECEIPT, ProjectFinanceType.ACTUAL_PAYMENT],
          },
          status: { $nin: [ProjectFinanceStatus.CANCELLED, ProjectFinanceStatus.REJECTED] },
        },
      },
      {
        $group: {
          _id: '$linkedForecastId',
          count: { $sum: 1 },
          total: { $sum: '$finalAmount' },
        },
      },
    ]),
  ]);

  const invoiceMap = new Map(
    linkedInvoices.map((item) => [String(item._id), item]),
  );
  const actualMap = new Map(linkedActuals.map((item) => [String(item._id), item]));

  return forecasts.map((forecast: any) => {
    const id = String(forecast._id);
    const invoiceStats = invoiceMap.get(id);
    const actualStats = actualMap.get(id);

    return {
      id,
      title: forecast.title,
      type: forecast.type,
      typeLabel: forecast.typeLabel,
      direction: forecast.direction,
      directionLabel: forecast.directionLabel,
      forecastAmount: forecast.finalAmount,
      achievedAmount: forecast.achievedAmount,
      remainingAmount: forecast.remainingAmount,
      achievementPercent: forecast.achievementPercent,
      forecastDate: forecast.forecastDate,
      dueDate: forecast.dueDate,
      status: forecast.status,
      statusLabel: forecast.statusLabel,
      linkedInvoicesCount: invoiceStats?.count || 0,
      linkedInvoicesAmount: invoiceStats?.total || 0,
      linkedActualTransactionsCount: actualStats?.count || 0,
      linkedActualTransactionsAmount: actualStats?.total || 0,
      varianceReason: forecast.notAchievedReason || forecast.delayReason || '',
      registeredBy: forecast.registeredById || null,
      approvedBy: forecast.approvedById || null,
      createdAt: forecast.createdAt,
      updatedAt: forecast.updatedAt,
    };
  });
};

export const buildProjectCashflowReport = async (projectId: Types.ObjectId | string) => {
  const records = await ProjectFinanceRecord.aggregate([
    {
      $match: {
        projectId: new Types.ObjectId(String(projectId)),
        status: { $nin: [ProjectFinanceStatus.CANCELLED, ProjectFinanceStatus.REJECTED] },
      },
    },
    {
      $addFields: {
        reportDate: {
          $ifNull: ['$actualDate', { $ifNull: ['$forecastDate', { $ifNull: ['$dueDate', '$createdAt'] }] }],
        },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$reportDate' },
          month: { $month: '$reportDate' },
        },
        forecastIncome: {
          $sum: {
            $cond: [{ $eq: ['$type', ProjectFinanceType.INCOME_FORECAST] }, '$finalAmount', 0],
          },
        },
        actualIncome: {
          $sum: {
            $cond: [{ $eq: ['$type', ProjectFinanceType.ACTUAL_RECEIPT] }, '$finalAmount', 0],
          },
        },
        forecastExpense: {
          $sum: {
            $cond: [{ $eq: ['$type', ProjectFinanceType.EXPENSE_FORECAST] }, '$finalAmount', 0],
          },
        },
        actualExpense: {
          $sum: {
            $cond: [{ $eq: ['$type', ProjectFinanceType.ACTUAL_PAYMENT] }, '$finalAmount', 0],
          },
        },
      },
    },
    {
      $sort: {
        '_id.year': 1,
        '_id.month': 1,
      },
    },
  ]);

  return records.map((item) => {
    const month = `${item._id.year}-${String(item._id.month).padStart(2, '0')}`;
    const netForecast = roundMoney(item.forecastIncome - item.forecastExpense);
    const netActual = roundMoney(item.actualIncome - item.actualExpense);

    return {
      month,
      forecastIncome: roundMoney(item.forecastIncome),
      actualIncome: roundMoney(item.actualIncome),
      incomeVariance: roundMoney(item.actualIncome - item.forecastIncome),
      forecastExpense: roundMoney(item.forecastExpense),
      actualExpense: roundMoney(item.actualExpense),
      expenseVariance: roundMoney(item.actualExpense - item.forecastExpense),
      netForecast,
      netActual,
      netVariance: roundMoney(netActual - netForecast),
    };
  });
};

export const buildProjectPeopleFinanceReport = async (
  projectId: Types.ObjectId | string,
) => {
  const result = await ProjectFinanceRecord.aggregate([
    {
      $match: {
        projectId: new Types.ObjectId(String(projectId)),
        status: { $ne: ProjectFinanceStatus.CANCELLED },
      },
    },
    {
      $group: {
        _id: '$registeredById',
        submittedRecords: { $sum: 1 },
        approvedRecords: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$status',
                  [
                    ProjectFinanceStatus.APPROVED,
                    ProjectFinanceStatus.PARTIALLY_ACHIEVED,
                    ProjectFinanceStatus.ACHIEVED,
                    ProjectFinanceStatus.OVERDUE,
                  ],
                ],
              },
              1,
              0,
            ],
          },
        },
        rejectedRecords: {
          $sum: {
            $cond: [{ $eq: ['$status', ProjectFinanceStatus.REJECTED] }, 1, 0],
          },
        },
        totalSubmittedAmount: { $sum: '$finalAmount' },
        totalApprovedAmount: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$status',
                  [
                    ProjectFinanceStatus.APPROVED,
                    ProjectFinanceStatus.PARTIALLY_ACHIEVED,
                    ProjectFinanceStatus.ACHIEVED,
                    ProjectFinanceStatus.OVERDUE,
                  ],
                ],
              },
              '$finalAmount',
              0,
            ],
          },
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    {
      $unwind: {
        path: '$user',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        userId: { $toString: '$_id' },
        userName: {
          $ifNull: ['$user.fullName', 'کاربر نامشخص'],
        },
        userRole: '$user.role',
        submittedRecords: 1,
        approvedRecords: 1,
        rejectedRecords: 1,
        totalSubmittedAmount: 1,
        totalApprovedAmount: 1,
      },
    },
    {
      $sort: {
        totalSubmittedAmount: -1,
      },
    },
  ]);

  return result;
};
