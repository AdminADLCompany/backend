const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");

const isAuthenticatedUser = require("../middleware/auth");

const {
  getAllProcesses,
  getProcessById,
  getProcessByDepartmentId,
  createProcess,
  updateProcess,
  deleteProcess,
  addHeader,
  deleteHeader,
  addData,
  updateData,
  deleteData,
  getaProcessHistory,
  getProcessRowHistory,
  getProductDetails,
  deleteAllProcessData,
  getMainDashBoardDetails,
  getNPDDashboardDetails,
  getProductDashboard,
  getRevisionControlDashboard,
  getOEEDashboard,
  getDashboardProductReport,
  getInhouseDashboard,
  getCustomerQualityDashboard,
  getIncomingInspectionDashboard,
  getQualityAuditsDashboard,
  getContinuousImprovementDashboard,
  getEmployeeOverheadDashboard,
  getEmployeeAttendanceDashboard,
  getProcurementRegisterDashboard,
  getInwardDashboard,
  getSalesCustomerCount,
  getSalesTrend,
  getQuotationStatus,
  getSalesOrderDetails,
  getSalesPaymentAndDelivery,
  getSalesTrailStatus,
} = require("../controllers/processController");

router.route("/deleteAllData").delete(deleteAllProcessData);
router
  .route("/dashboard")
  .get(getMainDashBoardDetails)
  .post(getMainDashBoardDetails);
router.route("/all").get(isAuthenticatedUser, getAllProcesses);
router.route("/search").get(isAuthenticatedUser, getProductDetails);

router.route('/design/npdRegister').get(getNPDDashboardDetails);
router.route('/design/productsDashboard').get(getProductDashboard);
router.route('/design/revisionControl').get(getRevisionControlDashboard);
router.route('/manufacturing/oeeDashboard').get(getOEEDashboard);
router.route('/manufacturing/productionReportDashboard').get(getDashboardProductReport);
router.route('/manufacturing/inhouseDashboard').get(getInhouseDashboard);
router.route('/quality/customercomplientRegister').get(getCustomerQualityDashboard);
router.route('/quality/incomingInspection').get(getIncomingInspectionDashboard);
router.route('/quality/qualityAuditDashboard').get(getQualityAuditsDashboard);
router.route('/quality/continuousImprovement').get(getContinuousImprovementDashboard);
router.route('/hr/overheadDashboard').get(getEmployeeOverheadDashboard);
router.route('/hr/attendanceDashboard').get(getEmployeeAttendanceDashboard);
router.route('/purchase/procurementDashboard').get(getProcurementRegisterDashboard);
router.route('/purchase/inwardDashboard').get(getInwardDashboard);
router.route('/sales/customerCount').get(getSalesCustomerCount);
router.route('/sales/salesTrend').get(getSalesTrend);
router.route('/sales/quotationStatus').get(getQuotationStatus);
router.route('/sales/orderDetails').get(getSalesOrderDetails);
router.route('/sales/paymentAndDelivery').get(getSalesPaymentAndDelivery);
router.route('/sales/trailStatus').get(getSalesTrailStatus);

router.route("/create").post(isAuthenticatedUser, createProcess);
router
  .route("/department/:id")
  .get(isAuthenticatedUser, getProcessByDepartmentId);
router
  .route("/:id")
  .get(isAuthenticatedUser, getProcessById)
  .put(isAuthenticatedUser, updateProcess)
  .delete(isAuthenticatedUser, deleteProcess);
router
  .route("/headers/:id")
  .post(isAuthenticatedUser, addHeader)
  .delete(isAuthenticatedUser, deleteHeader);

router
  .route("/data/:id")
  .post(
    isAuthenticatedUser,
    upload.fields([
      { name: "UPLOAD", maxCount: 1 },
      { name: "BEFORE", maxCount: 1 },
      { name: "AFTER", maxCount: 1 },
      { name: "CERTIFICATE", maxCount: 1 },
      { name: "ACTION REPORT", maxCount: 1 },
      { name: "NPD FORM", maxCount: 1 },
      { name: "EVALUATE", maxCount: 1 },
      { name: "IMAGE", maxCount: 1 },
      { name: "FILE UPLOAD", maxCount: 1 },
      { name: "CALIBRATION CERTIFICATE NO / DATE", maxCount: 1 },
      { name: "SERVICE REPORT", maxCount: 1 },
      { name: "T-REPORT", maxCount: 1 },
      { name: "MASTER PIECE UPLOAD", maxCount: 1 },
    ]),
    addData,
  )
  .put(
    isAuthenticatedUser,
    upload.fields([
      { name: "UPLOAD", maxCount: 1 },
      { name: "BEFORE", maxCount: 1 },
      { name: "AFTER", maxCount: 1 },
      { name: "CERTIFICATE", maxCount: 1 },
      { name: "ACTION REPORT", maxCount: 1 },
      { name: "NPD FORM", maxCount: 1 },
      { name: "EVALUATE", maxCount: 1 },
      { name: "IMAGE", maxCount: 1 },
      { name: "FILE UPLOAD", maxCount: 1 },
      { name: "CALIBRATION CERTIFICATE NO / DATE", maxCount: 1 },
      { name: "SERVICE REPORT", maxCount: 1 },
      { name: "T-REPORT", maxCount: 1 },
      { name: "MASTER PIECE UPLOAD", maxCount: 1 },
    ]),
    updateData,
  )
  .delete(isAuthenticatedUser, deleteData);

router.route("/history/:id").get(isAuthenticatedUser, getaProcessHistory);
router
  .route("/history/:id/:rowId")
  .get(isAuthenticatedUser, getProcessRowHistory);

module.exports = router;
