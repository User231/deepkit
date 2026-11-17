// externals: const_0, readDouble_0, nanToZero_0, readNumberValue_0, readBSONStringDirect_0, readStringValue_0, readBooleanValue_0, skipValue_0, skipCString_0
'use strict';
return function(buffer,offset){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var id_5=0;
var name_6="";
var active_7=false;
var note_8=const_0;
var score_9=const_0;
while(o_4<end_3){
    var type_10=buffer[o_4];
    o_4+=1;
    if(type_10===0){
        break;
    }
    if(buffer[o_4]===105&&buffer[(o_4+1)]===100&&buffer[(o_4+2)]===0){
        o_4+=3;
        if(type_10===16){
            id_5=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
            o_4+=4;
        }else{
            if(type_10===1){
                var dblVal_18=readDouble_0(buffer,o_4);
                id_5=nanToZero_0(dblVal_18);
                o_4+=8;
            }else{
                var numFallback_19=readNumberValue_0(buffer,o_4,type_10);
                id_5=numFallback_19[0];
                o_4+=numFallback_19[1];
            }
        }
    }else{
        if(buffer[o_4]===110&&buffer[(o_4+1)]===97&&buffer[(o_4+2)]===109&&buffer[(o_4+3)]===101&&buffer[(o_4+4)]===0){
            o_4+=5;
            if(type_10===2){
                var strLen_16=(((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)))-1);
                o_4+=4;
                name_6=readBSONStringDirect_0(buffer,o_4,strLen_16);
                o_4+=(strLen_16+1);
            }else{
                var strFallback_17=readStringValue_0(buffer,o_4,type_10);
                name_6=strFallback_17[0];
                o_4+=strFallback_17[1];
            }
        }else{
            if(buffer[o_4]===97&&buffer[(o_4+1)]===99&&buffer[(o_4+2)]===116&&buffer[(o_4+3)]===105&&buffer[(o_4+4)]===118&&buffer[(o_4+5)]===101&&buffer[(o_4+6)]===0){
                o_4+=7;
                if(type_10===8){
                    active_7=buffer[o_4]===1;
                    o_4+=1;
                }else{
                    var boolFallback_15=readBooleanValue_0(buffer,o_4,type_10);
                    active_7=boolFallback_15[0];
                    o_4+=boolFallback_15[1];
                }
            }else{
                if(buffer[o_4]===110&&buffer[(o_4+1)]===111&&buffer[(o_4+2)]===116&&buffer[(o_4+3)]===101&&buffer[(o_4+4)]===0){
                    o_4+=5;
                    if((type_10===10||type_10===6)){
                        o_4=skipValue_0(buffer,o_4,type_10);
                        note_8=undefined;
                    }else{
                        if(type_10===2){
                            var strLen_13=(((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)))-1);
                            o_4+=4;
                            note_8=readBSONStringDirect_0(buffer,o_4,strLen_13);
                            o_4+=(strLen_13+1);
                        }else{
                            var strFallback_14=readStringValue_0(buffer,o_4,type_10);
                            note_8=strFallback_14[0];
                            o_4+=strFallback_14[1];
                        }
                    }
                }else{
                    if(buffer[o_4]===115&&buffer[(o_4+1)]===99&&buffer[(o_4+2)]===111&&buffer[(o_4+3)]===114&&buffer[(o_4+4)]===101&&buffer[(o_4+5)]===0){
                        o_4+=6;
                        if((type_10===10||type_10===6)){
                            score_9=null;
                            o_4=skipValue_0(buffer,o_4,type_10);
                        }else{
                            if(type_10===16){
                                score_9=((buffer[o_4]|(buffer[(o_4+1)]<<8))|((buffer[(o_4+2)]<<16)|(buffer[(o_4+3)]<<24)));
                                o_4+=4;
                            }else{
                                if(type_10===1){
                                    var dblVal_11=readDouble_0(buffer,o_4);
                                    score_9=nanToZero_0(dblVal_11);
                                    o_4+=8;
                                }else{
                                    var numFallback_12=readNumberValue_0(buffer,o_4,type_10);
                                    score_9=numFallback_12[0];
                                    o_4+=numFallback_12[1];
                                }
                            }
                        }
                    }else{
                        o_4=skipCString_0(buffer,o_4);
                        o_4=skipValue_0(buffer,o_4,type_10);
                    }
                }
            }
        }
    }
}
var result_20={};
result_20.id=id_5;
result_20.name=name_6;
result_20.active=active_7;
if(note_8!==const_0){
    result_20.note=note_8;
}
if(score_9!==const_0){
    result_20.score=score_9;
}
return result_20;
}

// externals: readDouble_0, nanToZero_0, readNumberValue_0, const_0, readBSONStringDirect_0, readStringValue_0, readBooleanValue_0, const_1, skipValue_0, fn_0
'use strict';
function _nfn_0(buffer,o,ft){
var ho_3=o;
var val_4=0;
if(ft===16){
    val_4=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
    ho_3+=4;
}else{
    if(ft===1){
        var dblVal_5=readDouble_0(buffer,ho_3);
        val_4=nanToZero_0(dblVal_5);
        ho_3+=8;
    }else{
        var numFallback_6=readNumberValue_0(buffer,ho_3,ft);
        val_4=numFallback_6[0];
        ho_3+=numFallback_6[1];
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_1(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===105&&buffer[(o+2)]===100&&buffer[(o+3)]===0){
        var do_4=(o+4);
        if(ft_3===16){
            const_0[0]=((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)));
            const_0[1]=(do_4+4);
            return;
        }
        _nfn_0(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=0;
const_0[1]=o;
}
function _nfn_2(buffer,o,ft){
var ho_3=o;
var val_4="";
if(ft===2){
    var strLen_5=(((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)))-1);
    ho_3+=4;
    val_4=readBSONStringDirect_0(buffer,ho_3,strLen_5);
    ho_3+=(strLen_5+1);
}else{
    var strFallback_6=readStringValue_0(buffer,ho_3,ft);
    val_4=strFallback_6[0];
    ho_3+=strFallback_6[1];
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_3(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===110&&buffer[(o+2)]===97&&buffer[(o+3)]===109&&buffer[(o+4)]===101&&buffer[(o+5)]===0){
        var do_4=(o+6);
        if(ft_3===2){
            var strLen_5=(((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)))-1);
            var strStart_6=(do_4+4);
            const_0[0]=readBSONStringDirect_0(buffer,strStart_6,strLen_5);
            const_0[1]=(strStart_6+(strLen_5+1));
            return;
        }
        _nfn_2(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]="";
const_0[1]=o;
}
function _nfn_4(buffer,o,ft){
var ho_3=o;
var val_4=false;
if(ft===8){
    val_4=buffer[ho_3]===1;
    ho_3+=1;
}else{
    var boolFallback_5=readBooleanValue_0(buffer,ho_3,ft);
    val_4=boolFallback_5[0];
    ho_3+=boolFallback_5[1];
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_5(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===97&&buffer[(o+2)]===99&&buffer[(o+3)]===116&&buffer[(o+4)]===105&&buffer[(o+5)]===118&&buffer[(o+6)]===101&&buffer[(o+7)]===0){
        var do_4=(o+8);
        if(ft_3===8){
            const_0[0]=buffer[do_4]===1;
            const_0[1]=(do_4+1);
            return;
        }
        _nfn_4(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=false;
const_0[1]=o;
}
function _nfn_6(buffer,o,ft){
var ho_3=o;
var val_4=const_1;
if((ft===10||ft===6)){
    val_4=undefined;
}else{
    if(ft===2){
        var strLen_5=(((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)))-1);
        ho_3+=4;
        val_4=readBSONStringDirect_0(buffer,ho_3,strLen_5);
        ho_3+=(strLen_5+1);
    }else{
        var strFallback_6=readStringValue_0(buffer,ho_3,ft);
        val_4=strFallback_6[0];
        ho_3+=strFallback_6[1];
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_7(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===110&&buffer[(o+2)]===111&&buffer[(o+3)]===116&&buffer[(o+4)]===101&&buffer[(o+5)]===0){
        var do_4=(o+6);
        if(ft_3===2){
            var strLen_5=(((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)))-1);
            var strStart_6=(do_4+4);
            const_0[0]=readBSONStringDirect_0(buffer,strStart_6,strLen_5);
            const_0[1]=(strStart_6+(strLen_5+1));
            return;
        }
        _nfn_6(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=const_1;
const_0[1]=o;
}
function _nfn_8(buffer,o,ft){
var ho_3=o;
var val_4=const_1;
if((ft===10||ft===6)){
    val_4=null;
    ho_3=skipValue_0(buffer,ho_3,ft);
}else{
    if(ft===16){
        val_4=((buffer[ho_3]|(buffer[(ho_3+1)]<<8))|((buffer[(ho_3+2)]<<16)|(buffer[(ho_3+3)]<<24)));
        ho_3+=4;
    }else{
        if(ft===1){
            var dblVal_5=readDouble_0(buffer,ho_3);
            val_4=nanToZero_0(dblVal_5);
            ho_3+=8;
        }else{
            var numFallback_6=readNumberValue_0(buffer,ho_3,ft);
            val_4=numFallback_6[0];
            ho_3+=numFallback_6[1];
        }
    }
}
const_0[0]=val_4;
const_0[1]=ho_3;
return;
}
function _nfn_9(buffer,o,end){
if(o<end){
    var ft_3=buffer[o];
    if(ft_3!==0&&buffer[(o+1)]===115&&buffer[(o+2)]===99&&buffer[(o+3)]===111&&buffer[(o+4)]===114&&buffer[(o+5)]===101&&buffer[(o+6)]===0){
        var do_4=(o+7);
        if(ft_3===16){
            const_0[0]=((buffer[do_4]|(buffer[(do_4+1)]<<8))|((buffer[(do_4+2)]<<16)|(buffer[(do_4+3)]<<24)));
            const_0[1]=(do_4+4);
            return;
        }
        _nfn_8(buffer,do_4,ft_3);
        return;
    }
}
const_0[0]=const_1;
const_0[1]=o;
}
return function(buffer,offset=0){
var docSize_2=((buffer[offset]|(buffer[(offset+1)]<<8))|((buffer[(offset+2)]<<16)|(buffer[(offset+3)]<<24)));
var end_3=(offset+(docSize_2-1));
var o_4=(offset+4);
var id_5=0;
var name_6="";
var active_7=false;
var note_8=const_1;
var score_9=const_1;
_nfn_1(buffer,o_4,end_3);
id_5=const_0[0];
o_4=const_0[1];
_nfn_3(buffer,o_4,end_3);
name_6=const_0[0];
o_4=const_0[1];
_nfn_5(buffer,o_4,end_3);
active_7=const_0[0];
o_4=const_0[1];
_nfn_7(buffer,o_4,end_3);
note_8=const_0[0];
o_4=const_0[1];
_nfn_9(buffer,o_4,end_3);
score_9=const_0[0];
o_4=const_0[1];
if(buffer[o_4]!==0){
    return fn_0(buffer,offset);
}
var result_10={};
result_10.id=id_5;
result_10.name=name_6;
result_10.active=active_7;
if(note_8!==const_1){
    result_10.note=note_8;
}
if(score_9!==const_1){
    result_10.score=score_9;
}
return result_10;
}
