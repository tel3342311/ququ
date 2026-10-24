import { useState, useCallback } from "react";

export const usePermissions = (showAlertDialog) => {
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useState(false);

  const requestMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ 麥克風權限測試成功",
          description: "麥克風權限運作正常！現在可以開始錄音了。"
        });
      } else {
        alert("✅ 麥克風權限運作正常！現在可以開始錄音了。");
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '麥克風權限被拒絕:', err);
      }
      setMicPermissionGranted(false);
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ 需要麥克風權限",
          description: "請授予麥克風權限以使用語音轉錄功能。"
        });
      } else {
        alert("❌ 需要麥克風權限！請授予麥克風權限以使用語音轉錄功能。");
      }
    }
  }, [showAlertDialog]);

  const testAccessibilityPermission = useCallback(async () => {
    try {
      await window.electronAPI.pasteText("蛐蛐輔助使用測試");
      setAccessibilityPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ 輔助使用權限測試成功",
          description: "輔助使用權限運作正常！請檢查測試文字是否出現在其他應用程式中。"
        });
      } else {
        alert("✅ 輔助使用權限運作正常！請檢查測試文字是否出現在其他應用程式中。");
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '輔助使用權限測試失敗:', err);
      }
      setAccessibilityPermissionGranted(false);
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ 需要輔助使用權限",
          description: "請在系統設定中授予輔助使用權限，以啟用自動貼上文字功能。"
        });
      } else {
        alert("❌ 需要輔助使用權限！請在系統設定中授予權限。");
      }
    }
  }, [showAlertDialog]);

  return {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
    setMicPermissionGranted,
    setAccessibilityPermissionGranted,
  };
};
