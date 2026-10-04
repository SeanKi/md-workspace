package com.smallproject.mdtiptap

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Android 15 는 앱을 상태 표시줄·내비게이션 막대 밑까지 그리게 한다. 웹뷰는 그 여백을
    // 모르므로 화면 위 글자가 시계·배터리와 겹친다. 막대 높이만큼 비워 준다.
    // 키보드(ime)도 함께 비운다 — 안 그러면 아래쪽 글을 칠 때 키보드에 가린다
    val root = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
