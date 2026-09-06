다음 개선 -&#x20;

* MDSyncEditor에 TreePane 에 Tree계층 - 폴더 아래 폴더와 file은 같은 intent로 맞춰줘야 함.
* 컬러 - 글씨 또는 배경 preset 변경 기능 상단 Toolbar에 추가
* mdsynceditor가끔 얼어붙는것 - 굳지 않게 하거나, 안되면, 사유나, 남는시간 표기
* 저장시 기저장된 파일내용과 다른 부분을 보여주는 기능
* 그냥 화면 어는 경우가 있네. 심각하군. MD Editor와 MDSyncNote 동일 - 바로 해결하거나, log를 찍어서 쉽게 알 수 있게 해야 할거 같음.
* Tree Pane 폴더의 tree item ㅍ폴더 앞의 화살표 펼치는 표시, 파일에는 없기에 intent가 서로 안맞게 보임, 딱 폴더 아이콘 보이는 횡 위치에 파일 아이콘도 표시되어야 어디에 소속되어 있는지 확인에 어려움이 없을것
* 한글의 경우 입력하는데로 조합중인 글짜가 바로 표시되게 할수는 없나?



## 개선사항 2026-09-05

### MD Editor

* MD Editor 첫 화면에 중복된 상자가 나오는 문제
* strikethrough text 툴바 지원
* Document vertical split기능 - 상단의 splitbar를 내리면 하나의 문서를 vertical로 둘로 나누어 볼수 있다.
*

### MDSyncEditor

* 위 MD Editor의 기능을 여기에도 그대로 적용한다.
* Tree Pane의 이름 바꾸기를 F2를 눌러서도 적용가능하도록 한다.
* &#x20;Tree Pane과 Content Pane 사이에 Split bar를 넣어 사이즈를 조정할 수 있도록 한다.
* Tree Pane에서 item을 3초 이상 누르고 있으면, Drag\&Drop 가능한 상태로 되어서, 이 파일을 다른 위치에 옮길 수 있도록 한다. 물론 이것이 filesystem에 준하기에 같은 폴더아래서 순서를 바꾸는 것을 불가능하고, 다른 폴더로 만 옮길 수 있다.
* 이름바꾸기, 위치 옮기기를 했을때도 자동 저장 시간 이후 git commit이 되도록 한다. 이름 바꾸기나, 위치 옮기기에 대한 내용을 commit에 기록해주면 좋다.