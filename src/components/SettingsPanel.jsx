import React, { useState } from "react";
import { Mic, Shield, Settings } from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import PermissionCard from "./ui/permission-card";
import { toast } from "sonner";
import NativeSpeechSettings from './NativeSpeechSettings';

const SettingsPanel = ({ onClose }) => {
  const showAlert = (alert) => {
    toast(alert.title, {
      description: alert.description,
      duration: 4000,
    });
  };

  const {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
  } = usePermissions(showAlert);


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900 chinese-title">設定</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <span className="text-gray-500 text-xl">×</span>
          </button>
        </div>

        {/* 内容区域 */}
        <div className="p-6 space-y-8">
          <NativeSpeechSettings />
          {/* 权限部分 */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 chinese-title">
              權限管理
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              測試與管理應用程式權限，確保麥克風與輔助使用功能正常運作。
            </p>
            
            <div className="space-y-4">
              <PermissionCard
                icon={Mic}
                title="麥克風權限"
                description="錄製語音所需的權限"
                granted={micPermissionGranted}
                onRequest={requestMicPermission}
                buttonText="測試麥克風"
              />

              <PermissionCard
                icon={Shield}
                title="輔助使用權限"
                description="自動貼上文字所需的權限"
                granted={accessibilityPermissionGranted}
                onRequest={testAccessibilityPermission}
                buttonText="測試權限"
              />
            </div>
          </div>

          {/* 应用信息部分 */}
          <div className="border-t pt-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 chinese-title">
              關於蛐蛐
            </h3>
            <div className="bg-gradient-to-r from-blue-50 to-green-50 p-4 rounded-lg">
              <p className="text-sm text-gray-700 mb-2">
                🎤 <strong>蛐蛐 (QuQu)</strong> - 基於 FunASR 與 AI 的中文語音轉文字應用程式
              </p>
              <p className="text-xs text-gray-600">
                • 高精度中文語音辨識<br/>
                • AI 智慧文字最佳化<br/>
                • 即時語音處理<br/>
                • 隱私保護設計
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
