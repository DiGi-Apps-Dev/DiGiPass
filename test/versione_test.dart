import 'dart:io';

import 'package:digipass/main.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('la versione mostrata è quella del pubspec', () {
    final riga = File('pubspec.yaml').readAsLinesSync().firstWhere((r) => r.startsWith('version:'));
    expect(riga.split(':')[1].trim().split('+').first, kVersione);
  });
}
